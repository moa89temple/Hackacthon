import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import 'connections_controller.dart';

/// The button that starts a Takeover for a Connection, or goes back to one under way.
class LogInButton extends StatelessWidget {
  const LogInButton({super.key, required this.connection, required this.connections, this.prominent = false});

  final Connection connection;
  final ConnectionsController connections;

  /// Whether Buddy is asking for this, rather than only offering it.
  final bool prominent;

  @override
  Widget build(BuildContext context) {
    final label = connections.takeoverSite == connection.id
        ? 'Continue logging in to ${connection.name}'
        : 'Log in to ${connection.name}';
    final onPressed = connections.openingLogin ? null : () => connections.logIn(connection);
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
    final theme = Theme.of(context);
    return Card(
      // It holds a heading and a button, so it's a set of separate nodes rather than one.
      semanticContainer: false,
      margin: const EdgeInsets.symmetric(vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              header: true,
              child: Text('${connection.name} needs you to log in', style: theme.textTheme.titleSmall),
            ),
            const SizedBox(height: 4),
            Text(
              "Buddy can't read ${connection.name} until you do. You log in yourself, and Buddy never learns your password.",
            ),
            const SizedBox(height: 12),
            LogInButton(connection: connection, connections: connections, prominent: true),
          ],
        ),
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
        final waiting = (connections.connections ?? const <Connection>[]).where((connection) => connection.needsLogin);
        if (waiting.isEmpty) return const SizedBox.shrink();
        return ConstrainedBox(
          // Large text scrolls here rather than pushing what's coming up off the screen.
          constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.45),
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final connection in waiting) LoginRequest(connection: connection, connections: connections),
              ],
            ),
          ),
        );
      },
    );
  }
}
