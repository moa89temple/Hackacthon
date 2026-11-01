import 'package:flutter/material.dart';

class TodayTab extends StatelessWidget {
  const TodayTab({super.key});

  @override
  Widget build(BuildContext context) => const _EmptyTab(
        icon: Icons.today,
        message: 'Nothing for today yet. Your Briefings, Alerts and Tasks will show up here.',
      );
}

class RoadmapTab extends StatelessWidget {
  const RoadmapTab({super.key});

  @override
  Widget build(BuildContext context) => const _EmptyTab(
        icon: Icons.map,
        message: "You don't have a Roadmap yet. It will show up here once you've set a Goal with Buddy.",
      );
}

class _EmptyTab extends StatelessWidget {
  const _EmptyTab({required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ExcludeSemantics(child: Icon(icon, size: 48, color: colors.primary)),
            const SizedBox(height: 16),
            Text(message, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}
