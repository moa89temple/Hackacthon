import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../design/theme.dart';

/// Buddy's round, friendly face. It's decorative, so screen readers skip it:
/// the text next to it always says who is speaking.
class BuddyAvatar extends StatelessWidget {
  const BuddyAvatar({super.key, required this.radius});

  final double radius;

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: SizedBox.square(
        dimension: radius * 2,
        child: const CustomPaint(painter: BuddyFacePainter()),
      ),
    );
  }
}

/// Drawn rather than an icon, so that the avatar and the app's own icon are the same face.
class BuddyFacePainter extends CustomPainter {
  const BuddyFacePainter({this.disc = BuddyColors.cherry, this.face = Colors.white, this.faceScale = 1});

  final Color disc;
  final Color face;

  /// Under 1, the face is smaller within its disc, as an adaptive icon needs.
  final double faceScale;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final side = size.shortestSide;
    canvas.drawCircle(center, side / 2, Paint()..color = disc);

    final unit = side * faceScale;
    final features = Paint()
      ..color = face
      ..style = PaintingStyle.fill;
    final eyeRadius = unit * 0.055;
    final eyeY = center.dy - unit * 0.1;
    canvas.drawCircle(Offset(center.dx - unit * 0.16, eyeY), eyeRadius, features);
    canvas.drawCircle(Offset(center.dx + unit * 0.16, eyeY), eyeRadius, features);

    final smile = Paint()
      ..color = face
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = unit * 0.06;
    final smileBox = Rect.fromCenter(center: Offset(center.dx, center.dy + unit * 0.02), width: unit * 0.46, height: unit * 0.42);
    canvas.drawArc(smileBox, math.pi * 0.16, math.pi * 0.68, false, smile);
  }

  @override
  bool shouldRepaint(BuddyFacePainter oldDelegate) => disc != oldDelegate.disc || face != oldDelegate.face || faceScale != oldDelegate.faceScale;
}
