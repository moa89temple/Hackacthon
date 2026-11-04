// Draws the app's icons from the same face as the avatar, and writes them where Android and iOS look for them.
//
//   cd app
//   flutter test test/visual/icon_tool.dart
//
// Its name doesn't end in _test.dart, so a plain `flutter test` leaves it out.

import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:buddy/design/theme.dart';
import 'package:buddy/widgets/buddy_avatar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> _draw(String path, int side, void Function(Canvas canvas, Size size) paint) async {
  final recorder = ui.PictureRecorder();
  final size = Size.square(side.toDouble());
  paint(Canvas(recorder, Offset.zero & size), size);
  final image = await recorder.endRecording().toImage(side, side);
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  File(path)
    ..createSync(recursive: true)
    ..writeAsBytesSync(bytes!.buffer.asUint8List());
}

void main() {
  test('draws the icons', () async {
    const densities = {'mdpi': 1.0, 'hdpi': 1.5, 'xhdpi': 2.0, 'xxhdpi': 3.0, 'xxxhdpi': 4.0};
    for (final MapEntry(key: density, value: scale) in densities.entries) {
      // The round icon for phones older than Android 8.
      await _draw('android/app/src/main/res/mipmap-$density/ic_launcher.png', (48 * scale).round(), (canvas, size) {
        const BuddyFacePainter().paint(canvas, size);
      });
      // The face alone. The phone puts it on the cherry background, in whatever shape it uses.
      await _draw('android/app/src/main/res/mipmap-$density/ic_launcher_foreground.png', (108 * scale).round(), (canvas, size) {
        const BuddyFacePainter(disc: Colors.transparent, faceScale: 1.1).paint(canvas, size);
      });
    }

    // iOS wants a full square with no transparency, and rounds the corners itself.
    const iosFolder = 'ios/Runner/Assets.xcassets/AppIcon.appiconset';
    final contents = jsonDecode(File('$iosFolder/Contents.json').readAsStringSync()) as Map<String, dynamic>;
    for (final image in (contents['images'] as List<dynamic>).cast<Map<String, dynamic>>()) {
      final points = double.parse((image['size'] as String).split('x').first);
      final scale = double.parse((image['scale'] as String).replaceAll('x', ''));
      await _draw('$iosFolder/${image['filename']}', (points * scale).round(), (canvas, size) {
        canvas.drawRect(Offset.zero & size, Paint()..color = BuddyColors.cherry);
        const BuddyFacePainter(faceScale: 1.25).paint(canvas, size);
      });
    }
  });
}
