import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Builds the camera view that reads QR codes. Tests replace it, since a camera needs a real phone.
typedef QrScannerBuilder = Widget Function(BuildContext context, ValueChanged<String> onScanned);

Widget cameraQrScanner(BuildContext context, ValueChanged<String> onScanned) => _CameraScanner(onScanned: onScanned);

class _CameraScanner extends StatefulWidget {
  const _CameraScanner({required this.onScanned});

  final ValueChanged<String> onScanned;

  @override
  State<_CameraScanner> createState() => _CameraScannerState();
}

class _CameraScannerState extends State<_CameraScanner> {
  final _controller = MobileScannerController(formats: const [BarcodeFormat.qrCode]);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MobileScanner(
      controller: _controller,
      onDetect: (capture) {
        final text = capture.barcodes.firstOrNull?.rawValue;
        if (text != null) widget.onScanned(text);
      },
      errorBuilder: (context, error) => Center(
        child: Semantics(
          container: true,
          liveRegion: true,
          child: const Padding(
            padding: EdgeInsets.all(24),
            child: Text(
              "Buddy can't use the camera. Go back and type the code instead.",
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white),
            ),
          ),
        ),
      ),
    );
  }
}
