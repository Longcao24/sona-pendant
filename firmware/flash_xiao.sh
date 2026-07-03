#!/bin/bash
# Flash XIAO nRF52840 Sense via UF2
# Usage: ./flash_xiao.sh <sketch_dir>
# Example: ./flash_xiao.sh ~/sketches/myblink

SKETCH_DIR="$1"
SKETCH_NAME=$(basename "$SKETCH_DIR")
FQBN="adafruit:nrf52:feather52840sense"
CACHE_DIR=$(arduino-cli compile -b "$FQBN" "$SKETCH_DIR" --format json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['builder_result']['build_path'])" 2>/dev/null)

echo "Compiling $SKETCH_NAME..."
arduino-cli compile -b "$FQBN" "$SKETCH_DIR" 2>&1
if [ $? -ne 0 ]; then echo "Compile failed"; exit 1; fi

HEX=$(find ~/Library/Caches/arduino/sketches -name "${SKETCH_NAME}.ino.hex" 2>/dev/null | head -1)
if [ -z "$HEX" ]; then echo "No hex found"; exit 1; fi

echo "Converting to UF2..."
python3 /tmp/uf2conv.py --family 0xADA52840 --convert "$HEX" --output /tmp/flash_xiao.uf2
if [ $? -ne 0 ]; then echo "UF2 conversion failed"; exit 1; fi

echo "Double-tap reset on XIAO now (waiting for XIAO-SENSE volume)..."
until ls /Volumes/XIAO-SENSE 2>/dev/null; do sleep 0.3; done

echo "Flashing..."
python3 -c "
import os
data = open('/tmp/flash_xiao.uf2','rb').read()
fd = os.open('/Volumes/XIAO-SENSE/flash_xiao.uf2', os.O_WRONLY|os.O_CREAT, 0o644)
os.write(fd, data)
os.close(fd)
"
echo "Done. Board rebooting."
