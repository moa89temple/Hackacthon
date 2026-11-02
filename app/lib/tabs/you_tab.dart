import 'package:flutter/material.dart';

import '../activity/activity_screen.dart';
import '../backend/buddy_backend.dart';
import '../connections/connections_controller.dart';
import '../connections/connections_section.dart';
import '../profile/profile_controller.dart';
import '../profile/profile_section.dart';
class YouTab extends StatelessWidget {
  const YouTab({
    super.key,
    required this.backend,
    required this.profile,
    required this.connections,
  });

  final BuddyBackend backend;
  final ProfileController profile;
  final ConnectionsController connections;

  void _openActivity(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (context) => ActivityScreen(backend: backend)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ConnectionsSection(connections: connections),
        const SizedBox(height: 32),
        ProfileSection(profile: profile),
        const SizedBox(height: 32),
        Semantics(
          header: true,
          child: Text('Activity', style: theme.textTheme.titleMedium),
        ),
        const SizedBox(height: 8),
        const Text('Everything Buddy read and did for you, and how it decided each reply.'),
        const SizedBox(height: 12),
        OutlinedButton(
          onPressed: () => _openActivity(context),
          child: const Text('See your Activity'),
        ),
        const SizedBox(height: 32),
        const Text(
          'Hackathon prototype, not an official Temple University service',
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}
