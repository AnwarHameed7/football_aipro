"""
Football AI Pro - Video Loader
Handles local files, file uploads, and URL downloads.
"""

import cv2
import tempfile
import re
import os
from typing import Optional, Dict, Any


class VideoLoader:
    """Wraps OpenCV VideoCapture with metadata extraction."""

    def __init__(self):
        self.cap: Optional[cv2.VideoCapture] = None
        self.path: Optional[str] = None
        self.info: Dict[str, Any] = {}

    def open(self, path: str) -> Optional[Dict[str, Any]]:
        self.release()
        if not os.path.isfile(path):
            return None
        self.cap = cv2.VideoCapture(path)
        if not self.cap.isOpened():
            return None
        self.path = path
        fps = self.cap.get(cv2.CAP_PROP_FPS) or 30.0
        w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fc = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.info = {
            "width": w,
            "height": h,
            "fps": fps,
            "frames": fc,
            "duration": fc / fps if fps > 0 else 0,
            "path": path,
        }
        return self.info

    def read_frame(self):
        if self.cap is None:
            return False, None
        return self.cap.read()

    def seek(self, frame_idx: int):
        if self.cap:
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)

    def release(self):
        if self.cap:
            self.cap.release()
            self.cap = None

    @staticmethod
    def save_upload(uploaded_file) -> str:
        """Save a Streamlit UploadedFile to a temp path and return it."""
        suffix = os.path.splitext(uploaded_file.name)[1] or ".mp4"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        tmp.write(uploaded_file.read())
        tmp.close()
        return tmp.name

    @staticmethod
    def download_url(url: str, progress_callback=None) -> Optional[str]:
        """
        Download a video from URL (supports Google Drive share links).
        Returns temp file path or None on failure.
        """
        import requests

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        try:
            # Google Drive handling
            gdrive = re.search(r"drive[.]google[.]com/file/d/([^/]+)", url)
            if gdrive:
                fid = gdrive.group(1)
                dl_url = f"https://drive.google.com/uc?export=download&id={fid}"
                session = requests.Session()
                resp = session.get(dl_url, stream=True, timeout=30)
                for k, v in resp.cookies.items():
                    if k.startswith("download_warning"):
                        dl_url += f"&confirm={v}"
                        resp = session.get(dl_url, stream=True, timeout=30)
                        break
            else:
                resp = requests.get(url, stream=True, timeout=30)

            resp.raise_for_status()
            total = int(resp.headers.get("content-length", 0))
            downloaded = 0
            for chunk in resp.iter_content(chunk_size=65536):
                if chunk:
                    tmp.write(chunk)
                    downloaded += len(chunk)
                    if progress_callback and total > 0:
                        progress_callback(downloaded / total)
            tmp.close()
            return tmp.name
        except Exception:
            tmp.close()
            if os.path.exists(tmp.name):
                os.unlink(tmp.name)
            return None
