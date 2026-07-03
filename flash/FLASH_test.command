#!/bin/bash
UF2="/Users/hoanglong/Desktop/necklace-insole/flash/2_ble_test.uf2"
echo "============================================"
echo " Flashing: 2_ble_test.uf2"
echo "============================================"
echo ""
echo ">>> DOUBLE-TAP the XIAO reset button NOW <<<"
echo "    (waiting for XIAO-SENSE drive...)"
until [ -d /Volumes/XIAO-SENSE ]; do sleep 0.3; done
sleep 1.5   # let the drive finish mounting (writable)
python3 - "$UF2" << 'PY'
import os, sys, time, subprocess
src = sys.argv[1]
data = open(src, 'rb').read()
dst = '/Volumes/XIAO-SENSE/fw.uf2'
for attempt in range(8):
    try:
        fd = os.open(dst, os.O_WRONLY | os.O_CREAT, 0o644)
        os.write(fd, data); os.close(fd)
        print("\n✅ Written %d bytes — FLASHED OK" % len(data))
        sys.exit(0)
    except PermissionError:
        if attempt == 0:
            # drive mounted read-only (dirty FAT) -> remount
            print("drive read-only, remounting...")
            subprocess.run(["diskutil","unmount","force","/Volumes/XIAO-SENSE"],
                           capture_output=True)
            print(">>> DOUBLE-TAP reset AGAIN <<<")
            while not os.path.isdir('/Volumes/XIAO-SENSE'): time.sleep(0.3)
            time.sleep(1.5)
        else:
            time.sleep(0.8)
    except FileNotFoundError:
        time.sleep(0.5)
print("\n❌ Could not write. Double-tap again and re-run this file.")
sys.exit(1)
PY
RC=$?
echo ""
if [ $RC -eq 0 ]; then echo "Now open the app and Scan for XIAO-Audio."; fi
echo "(you can close this window)"
