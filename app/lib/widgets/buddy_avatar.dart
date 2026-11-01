import 'package:flutter/material.dart';

/// Buddy's round, friendly face. It's decorative, so screen readers skip it:
/// the text next to it always says who is speaking.
class BuddyAvatar extends StatelessWidget {
  const BuddyAvatar({super.key, required this.radius});

  final double radius;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ExcludeSemantics(
      child: CircleAvatar(
        radius: radius,
        backgroundColor: colors.primary,
        child: Icon(Icons.sentiment_very_satisfied_rounded, size: radius * 1.5, color: colors.onPrimary),
      ),
    );
  }
}
