import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import 'connections_controller.dart';
import 'read_permission_card.dart';

/// The You tab's list of what Buddy can read for the Student, and their controls over each one.
class ConnectionsSection extends StatelessWidget {
  const ConnectionsSection({super.key, required this.connections});

  final ConnectionsController connections;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: connections,
      builder: (context, _) {
        final list = connections.connections;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              header: true,
              child: Text('Connections', style: theme.textTheme.titleMedium),
            ),
            const SizedBox(height: 8),
            const Text('What Buddy can read for you. Each one stays off until you give its Read Permission.'),
            if (connections.couldNotLoad) ...[
              Semantics(
                liveRegion: true,
                child: const Padding(
                  padding: EdgeInsets.only(top: 12),
                  child: Text("Buddy couldn't load your Connections. Check that the backend is running."),
                ),
              ),
              TextButton(onPressed: connections.load, child: const Text('Try again')),
            ] else if (list == null)
              const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading your Connections'))
            else
              for (final connection in list) _ConnectionRow(connection: connection, connections: connections),
            if (connections.note case final note?)
              Semantics(
                container: true,
                liveRegion: true,
                child: Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(note, style: connections.noteIsProblem ? TextStyle(color: theme.colorScheme.error) : null),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _ConnectionRow extends StatelessWidget {
  const _ConnectionRow({required this.connection, required this.connections});

  final Connection connection;
  final ConnectionsController connections;

  String _status(BuildContext context) {
    if (!connection.on) return 'Off';
    final readAt = connection.lastReadAt?.toLocal();
    if (readAt == null) return "On. Buddy hasn't read it yet.";
    final localizations = MaterialLocalizations.of(context);
    final date = localizations.formatFullDate(readAt);
    final time = localizations.formatTimeOfDay(TimeOfDay.fromDateTime(readAt));
    return 'On. Last read $date at $time.';
  }

  void _openCard(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => ReadPermissionScreen(connection: connection, connections: connections),
      ),
    );
  }

  Future<void> _revoke(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        scrollable: true,
        title: Text('Revoke the Read Permission for ${connection.name}?'),
        content: Text(
          "Buddy stops reading ${connection.name}. This deletes the address and every fact from it. Whatever it already showed the AI stays in your conversation's history until that's deleted, and Buddy is told not to use it.",
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Revoke')),
        ],
      ),
    );
    if (confirmed == true) await connections.revoke(connection);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final reading = connections.reading.contains(connection.id);
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // One item, because on Android the status otherwise joins the sentence above the list.
          MergeSemantics(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  header: true,
                  child: Text(connection.name, style: theme.textTheme.titleSmall),
                ),
                Text(_status(context)),
                if (connection.lastReadProblem case final problem?)
                  Text(problem, style: TextStyle(color: theme.colorScheme.error)),
              ],
            ),
          ),
          const SizedBox(height: 4),
          // A Wrap, so that the buttons go on two lines when the text is large.
          Wrap(
            spacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: connection.on
                ? [
                    OutlinedButton(
                      onPressed: reading ? null : () => connections.read(connection),
                      child: reading
                          ? const Text('Reading…')
                          : Text('Read now', semanticsLabel: 'Read ${connection.name} now'),
                    ),
                    TextButton(
                      onPressed: () => _revoke(context),
                      child: Text('Revoke', semanticsLabel: 'Revoke the Read Permission for ${connection.name}'),
                    ),
                  ]
                : [
                    FilledButton(
                      onPressed: () => _openCard(context),
                      child: Text('Connect', semanticsLabel: 'Connect ${connection.name}'),
                    ),
                  ],
          ),
        ],
      ),
    );
  }
}
