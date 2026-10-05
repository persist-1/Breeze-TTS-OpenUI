"""Isolated inference process. JSON lines over stdin/stdout; no HTTP or global Python."""
from __future__ import annotations
import base64
import json
import queue
import sys
import threading
import traceback
from pathlib import Path

protocol = sys.stdout
sys.stdout = sys.stderr
cancel = threading.Event()
commands: queue.Queue = queue.Queue()

def send(**message):
    protocol.write(json.dumps(message,ensure_ascii=False)+'\n')
    protocol.flush()

def reader():
    for line in sys.stdin:
        try:
            command=json.loads(line)
            if command.get('type')=='cancel': cancel.set()
            else: commands.put(command)
        except Exception as error:
            send(type='error',message=str(error))
    cancel.set()
    commands.put(None)

def main():
    root=Path(sys.argv[1]).resolve()
    model_dir=(root/'models'/'Breeze-TTS-2').resolve()
    if not model_dir.is_relative_to(root): raise ValueError('模型路径位于应用外部。')
    vendor=(root/'services'/'python'/'vendor'/'breeze').resolve()
    if not vendor.is_relative_to(root): raise ValueError('推理代码路径位于应用外部。')
    sys.path.insert(0,str(vendor))
    import numpy as np
    import torch
    from breeze_infer.runtime import load_runtime,update_generation_config_for_breeze,set_all_seeds
    from breeze_infer.templates import get_template,prepare_inputs,select_template_name
    from models.fast_streaming import FastBreezeStreamingRuntime,FastStreamingConfig
    if not torch.cuda.is_available(): raise RuntimeError('未检测到可用 NVIDIA GPU。请检查显卡驱动；当前版本使用 CUDA 推理。')
    send(type='stage',message='加载模型与音频编解码器')
    tokenizer,model,codec=load_runtime(model_dir,device='cuda:0',attn_implementation='eager')
    update_generation_config_for_breeze(model)
    runtime=FastBreezeStreamingRuntime(model,codec,FastStreamingConfig(max_new_tokens=1500,max_seq_len=2048,fast_all=False,repetition_penalty=1.1),tokenizer=tokenizer)
    threading.Thread(target=reader,daemon=True).start()
    send(type='ready',sampleRate=runtime.sample_rate)
    while True:
        command=commands.get()
        if command is None: return
        cancel.clear()
        try:
            data=command['input'];request={'id':command['id'],'text':data['text'],'speaker':'S0'}
            if data.get('instruction'):request['instruction']=data['instruction']
            if data.get('reference'):
                ref=data['reference'];file=(root/'data'/'references'/(ref['assetId']+'.wav')).resolve()
                if not file.is_relative_to(root) or not file.is_file():raise FileNotFoundError('历史参考录音缺失，请更换音色重做。')
                request.update(ref_audio_path=str(file),ref_text=ref['transcript'])
            set_all_seeds(data['seed'])
            with torch.inference_mode():
                inputs=prepare_inputs(tokenizer,codec,model,[request],get_template(select_template_name(request)),guidance_scale=data['cfg'],guidance_scale_ref=None,guidance_scale_ins=None)
                lengths=[int(v.shape[-1]) for k,v in inputs.items() if k.endswith('prompt_ids') or k=='input_ids']
                if lengths and max(lengths)>=2047:raise ValueError('输入超过模型上下文预算，请缩短文稿、参考逐字稿或指导，并分段生成。')
                frames=0
                stream=runtime.iter_audio_chunks(inputs,request_id=command['id'],seed=data['seed'])
                try:
                    for chunk in stream:
                        if cancel.is_set():break
                        audio=np.asarray(chunk.audio,dtype=np.float32).reshape(-1)
                        pcm=(np.clip(audio,-1,1)*32767).astype('<i2').tobytes()
                        frames+=int(chunk.codec_frames)
                        if pcm:send(type='pcm',id=command['id'],data=base64.b64encode(pcm).decode('ascii'),sampleRate=runtime.sample_rate)
                finally:stream.close()
            if cancel.is_set():send(type='cancelled',id=command['id'])
            else:send(type='done',id=command['id'],truncated=frames>=1499,sampleRate=runtime.sample_rate)
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            send(type='error',id=command.get('id'),message=str(error),fatal=isinstance(error,torch.cuda.OutOfMemoryError))

if __name__=='__main__':
    try:main()
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        send(type='fatal',message=str(error))
        sys.exit(1)
