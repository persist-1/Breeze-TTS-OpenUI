"""ModelScope download with byte progress; every destination is portable-local."""
from __future__ import annotations
import json
import sys
import threading
import time
from pathlib import Path

def main():
    root = Path(sys.argv[1]).resolve()
    destination = root / 'models' / 'Breeze-TTS-2'
    cache = root / '.runtime' / 'cache' / 'modelscope'
    import tqdm.auto
    base_progress = tqdm.auto.tqdm
    class QuietProgress(base_progress):
        def __init__(self,*args,**kwargs):
            kwargs['disable']=True
            super().__init__(*args,**kwargs)
    tqdm.auto.tqdm=QuietProgress
    from modelscope import snapshot_download
    from modelscope.hub.api import HubApi
    from modelscope.hub.callback import ProgressCallback
    files = HubApi().get_model_files('BreezeBlue/Breeze-TTS-2', recursive=True)
    entries = [f for f in files if f.get('Type') == 'blob']
    total = sum(int(f.get('Size', 0)) for f in entries)
    completed = 0
    for item in entries:
        file = (destination / item['Path']).resolve()
        if not file.is_relative_to(root):
            raise ValueError('模型文件路径位于应用外部。')
        if file.is_file() and file.stat().st_size == int(item.get('Size', -1)):
            completed += file.stat().st_size
    transferred = 0
    last = 0.0
    lock = threading.Lock()
    def emit(stage):
        print(json.dumps({'type':'progress','stage':stage,'downloaded':min(total,completed+transferred),'total':total},ensure_ascii=False),flush=True)
    class GuiProgress(ProgressCallback):
        def update(self, size):
            nonlocal transferred, last
            with lock:
                transferred += size
                if time.monotonic()-last > .25:
                    last = time.monotonic()
                    emit('正在下载 '+self.filename)
        def end(self):
            with lock:
                emit('已下载 '+self.filename)
    emit('ModelScope 文件清单已读取')
    snapshot_download('BreezeBlue/Breeze-TTS-2',local_dir=str(destination),cache_dir=str(cache),progress_callbacks=[GuiProgress],max_workers=2)
    print(json.dumps({'type':'progress','stage':'下载完成，正在校验权重','downloaded':total,'total':total},ensure_ascii=False),flush=True)

if __name__ == '__main__':
    main()
