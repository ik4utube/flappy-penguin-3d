#!/usr/bin/env python
"""개발용 정적 서버. 브라우저가 낡은 JS를 물고 있지 않도록 캐시를 끈다.

    python serve.py [포트]      기본 8321
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):        # 접속 로그 소음 제거
        if '404' in (fmt % args):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8321
    print(f'http://localhost:{port}  (Ctrl+C 로 종료)')
    ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()
