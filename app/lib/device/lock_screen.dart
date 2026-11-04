import 'package:flutter/material.dart';

import '../design/parts.dart';
import '../design/theme.dart';
import '../widgets/buddy_avatar.dart';
import 'app_lock.dart';

/// Covers the whole app until the Student proves it's them.
class LockScreen extends StatelessWidget {
  const LockScreen({super.key, required this.asking, required this.lastResult, required this.onUnlock});

  /// Whether the phone's prompt is up.
  final bool asking;
  final UnlockResult? lastResult;
  final VoidCallback onUnlock;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final problem = switch (lastResult) {
      UnlockResult.noScreenLock =>
        "Set a screen lock in your phone's settings, then try again. Buddy stays locked without one, "
            'so nobody else can read it.',
      UnlockResult.failed => "Buddy couldn't check it's you. Try again.",
      _ => null,
    };

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 64),
              const Center(child: BuddyAvatar(radius: 40)),
              const SizedBox(height: 24),
              Semantics(
                header: true,
                child: Text('Buddy is locked', textAlign: TextAlign.center, style: theme.textTheme.headlineMedium),
              ),
              const SizedBox(height: 8),
              Text(
                "Use your fingerprint, face or your phone's screen lock to open Buddy.",
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(color: BuddyColors.inkSoft),
              ),
              const SizedBox(height: 32),
              FilledButton(onPressed: asking ? null : onUnlock, child: const Text('Unlock')),
              if (problem != null) Padding(padding: const EdgeInsets.only(top: 8), child: ProblemNote(problem)),
            ],
          ),
        ),
      ),
    );
  }
}
