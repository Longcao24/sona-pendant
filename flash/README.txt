XIAO nRF52840 Sense — firmware UF2 files
=========================================

HOW TO FLASH (drag-drop, no tools):
  1. Plug XIAO into USB.
  2. DOUBLE-TAP the reset button quickly.
  3. A drive called "XIAO-SENSE" appears in Finder.
  4. Drag the .uf2 file onto that drive.
  5. Drive disappears, board reboots running the new firmware. Done.


FILES
-----

2_ble_test.uf2   ← FLASH THIS FIRST (test)
   Bare BLE beacon. Does nothing but advertise the name "XIAO-Audio".
   After flashing: open the app -> Scan.
   - If "XIAO-Audio" appears  -> BLE works. Go flash 1_audio_full.uf2.
   - If it does NOT appear     -> tell me; BLE has a deeper problem.

1_audio_full.uf2  ← the real firmware
   PDM mic -> BLE audio streaming + LED status.
   LED guide once running:
     blue blinking = advertising (waiting for phone)
     blue solid    = phone connected
     red solid     = recording
     red/orange flicker near USB = battery charge LED (ignore)


PHONE APP CHECKLIST (Android)
-----------------------------
  - Bluetooth ON
  - Location / GPS ON   (Android refuses BLE scan results without it)
  - Grant the Bluetooth + Location permissions when the app asks
