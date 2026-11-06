import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../design/parts.dart';
import '../design/theme.dart';
import 'connections_controller.dart';

/// The button that starts a Takeover for a Connection, or goes back to one under way.
class LogInButton extends StatelessWidget {
  const LogInButton({super.key, required this.connection, required this.connections, this.prominent = false, this.onFinished, this.onWarning = false});

  final Connection connection;
  final ConnectionsController connections;

  /// Whether Buddy is asking for this, rather than only offering it.
  final bool prominent;

  /// Called once the Student is back from the live view and Buddy has had its look.
  final VoidCallback? onFinished;

  /// It sits on a warning's tint, where a white pill with cherry words reads better than a block of cherry.
  final bool onWarning;

  Future<void> _logIn() async {
    await connections.logIn(connection);
    onFinished?.call();
  }

  @override
  Widget build(BuildContext context) {
    final label = connections.takeoverSite == connection.id
        ? 'Continue logging in to ${connection.name}'
        : 'Log in to ${connection.name}';
    final onPressed = connections.openingLogin ? null : _logIn;
    if (onWarning) {
      return OutlinedButton(
        style: OutlinedButton.styleFrom(foregroundColor: BuddyColors.cherry, backgroundColor: BuddyColors.surface),
        onPressed: onPressed,
        child: Text(label),
      );
    }
    return prominent
        ? FilledButton(onPressed: onPressed, child: Text(label))
        : OutlinedButton(onPressed: onPressed, child: Text(label));
  }
}

/// Buddy asking for a Takeover, because its login has expired or there hasn't been one yet.
class LoginRequest extends StatelessWidget {
  const LoginRequest({super.key, required this.connection, required this.connections});

  final Connection connection;
  final ConnectionsController connections;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: NoticeCard(
        title: '${connection.name} needs you to log in',
        words: "Buddy can't read ${connection.name} until you do. You log in yourself, and Buddy never learns your password.",
        action: LogInButton(connection: connection, connections: connections, prominent: true, onWarning: true),
      ),
    );
  }
}

/// Several in one, because they share a sign-on, and a notice for each would push everything else off the screen.
class _SeveralLoginRequests extends StatelessWidget {
  const _SeveralLoginRequests({required this.waiting, required this.connections});

  final List<Connection> waiting;
  final ConnectionsController connections;

  String get _names {
    final names = [for (final connection in waiting) connection.name];
    return '${names.sublist(0, names.length - 1).join(', ')} and ${names.last}';
  }

  @override
  Widget build(BuildContext context) {
    return NoticeCard(
      title: '${waiting.length} Connections need you to log in',
      words: "Buddy can't read $_names until you do. You log in yourself, and Buddy never learns your password. Logging in to one of Temple's may log you in to the others.",
      action: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (index, connection) in waiting.indexed) ...[
            if (index > 0) const SizedBox(height: 8),
            LogInButton(connection: connection, connections: connections, prominent: true, onWarning: true),
          ],
        ],
      ),
    );
  }
}

/// Every Connection Buddy is asking the Student to log in to. Nothing at all when there are none.
class LoginRequests extends StatelessWidget {
  const LoginRequests({super.key, required this.connections});

  final ConnectionsController connections;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: connections,
      builder: (context, _) {
        final waiting = (connections.connections ?? const <Connection>[]).where((connection) => connection.needsLogin).toList();
        if (waiting.isEmpty) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (waiting.length == 1)
                LoginRequest(connection: waiting.single, connections: connections)
              else
                _SeveralLoginRequests(waiting: waiting, connections: connections),
              LoginProblem(connections: connections),
            ],
          ),
        );
      },
    );
  }
}

/// What went wrong with a login started from here, because the Student isn't on the screen that lists Connections.
class LoginProblem extends StatelessWidget {
  const LoginProblem({super.key, required this.connections});

  final ConnectionsController connections;

  @override
  Widget build(BuildContext context) {
    if (!connections.noteIsProblem) return const SizedBox.shrink();
    return switch (connections.note) {
      final note? => ProblemNote(note),
      null => const SizedBox.shrink(),
    };
  }
}
