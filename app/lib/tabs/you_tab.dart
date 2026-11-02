import 'package:flutter/material.dart';

import '../activity/activity_screen.dart';
import '../backend/buddy_backend.dart';
import '../connections/connections_controller.dart';
import '../connections/connections_section.dart';
import '../profile/profile_controller.dart';
import '../profile/profile_section.dart';
import '../takeover/live_view.dart';
import '../takeover/takeover_screen.dart';

const _canvas = 'canvas';

class YouTab extends StatefulWidget {
  const YouTab({
    super.key,
    required this.backend,
    required this.profile,
    required this.connections,
    required this.liveViewBuilder,
  });

  final BuddyBackend backend;
  final ProfileController profile;
  final ConnectionsController connections;
  final LiveViewBuilder liveViewBuilder;

  @override
  State<YouTab> createState() => _YouTabState();
}

class _YouTabState extends State<YouTab> {
  bool _takeoverUnderWay = false;
  bool _opening = false;

  /// What happened the last time the Student tried, for them to read.
  String? _note;
  bool _noteIsProblem = false;

  @override
  void initState() {
    super.initState();
    _checkForTakeover();
  }

  Future<void> _checkForTakeover() async {
    try {
      final takeover = await widget.backend.currentTakeover();
      if (mounted) setState(() => _takeoverUnderWay = takeover != null);
    } on Exception {
      // Starting a Takeover returns any Takeover under way, so the button still works.
    }
  }

  void _openActivity() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (context) => ActivityScreen(backend: widget.backend)),
    );
  }

  Future<void> _openLogin() async {
    setState(() {
      _opening = true;
      _note = null;
    });

    final Takeover takeover;
    try {
      takeover = await widget.backend.startTakeover(_canvas);
    } on Exception {
      if (mounted) {
        setState(() {
          _opening = false;
          _note = "Buddy couldn't open its browser. Check that Buddy's Browser is running, then try again.";
          _noteIsProblem = true;
        });
      }
      return;
    }
    if (!mounted) return;

    final finished = await Navigator.of(context).push<FinishedTakeover>(
      MaterialPageRoute(
        builder: (context) => TakeoverScreen(
          backend: widget.backend,
          takeover: takeover,
          liveViewBuilder: widget.liveViewBuilder,
        ),
      ),
    );
    if (!mounted) return;

    setState(() {
      _opening = false;
      if (finished != null) {
        _note = finished.signedIn
            ? 'You\'re logged in to ${finished.siteName}. Buddy opened "${finished.title}" to check.'
            : "Buddy couldn't confirm you're logged in to ${finished.siteName}. You can try logging in again.";
        _noteIsProblem = !finished.signedIn;
      }
    });
    await _checkForTakeover();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ConnectionsSection(connections: widget.connections),
        const SizedBox(height: 32),
        ProfileSection(profile: widget.profile),
        const SizedBox(height: 32),
        Semantics(
          header: true,
          child: Text('Logins', style: theme.textTheme.titleMedium),
        ),
        const SizedBox(height: 8),
        const Text('You log in yourself, and Buddy never learns your password.'),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: _opening ? null : _openLogin,
          child: Text(_takeoverUnderWay ? 'Continue logging in to Canvas' : 'Log in to Canvas'),
        ),
        if (_note case final note?)
          Semantics(
            container: true,
            liveRegion: true,
            child: Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(note, style: _noteIsProblem ? TextStyle(color: theme.colorScheme.error) : null),
            ),
          ),
        const SizedBox(height: 32),
        Semantics(
          header: true,
          child: Text('Activity', style: theme.textTheme.titleMedium),
        ),
        const SizedBox(height: 8),
        const Text('Everything Buddy read and did for you, and how it decided each reply.'),
        const SizedBox(height: 12),
        OutlinedButton(
          onPressed: _openActivity,
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
