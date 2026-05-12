import cv2
from urllib.parse import quote

ip       = "192.168.68.57"
password = "L2BC212E"
encoded  = quote(password, safe="")

ports = [554, 8554, 1935]
paths = [
    "/cam/realmonitor?channel=1&subtype=1",
    "/cam/realmonitor?channel=1&subtype=0",
    "/onvif1",
    "/onvif2",
    "/live/ch0",
    "/Streaming/Channels/101",
    "/Streaming/Channels/102",
    "/h264/ch1/main/av_stream",
]

print("Testing...\n")
found = False
for port in ports:
    for path in paths:
        url = f"rtsp://admin:{encoded}@{ip}:{port}{path}"
        cap = cv2.VideoCapture(url)
        opened = cap.isOpened()
        cap.release()
        if opened:
            print(f"\nSUCCESS!")
            print(f"  URL: {url}")
            found = True
            break
        else:
            print(f"FAILED  port={port}  path={path}")
    if found:
        break

if not found:
    print("\nAll failed.")
    print("Open http://192.168.68.57 in your browser, login, and enable RTSP, then retry.")
