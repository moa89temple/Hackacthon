import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../design/parts.dart';
import '../design/theme.dart';
import '../widgets/work_in_progress.dart';
import 'connections_controller.dart';
import 'login_request.dart';
import 'read_permission_card.dart';

/// So that each Connection can be told apart at a glance. A service the Student asked for gets the general one.
IconData connectionIcon(Connection connection) => switch (connection.id) {
      'google-calendar' => Icons.calendar_month_outlined,
      'canvas' => Icons.school_outlined,
      'tuportal' => Icons.account_balance_outlined,
      'dars' => Icons.checklist,
      'tumail' => Icons.mail_outline,
      'navigate360' => Icons.explore_outlined,
      'handshake' => Icons.handshake_outlined,
      _ => Icons.link,
    };

/// How a Connection stands, in the same words wherever it's shown.
String connectionStatus(BuildContext context, Connection connection) {
  if (connection.notReadableYet case final why?) return why;
  if (!connection.on) return 'Off';
  final readAt = connection.lastReadAt?.toLocal();
  if (readAt == null) return "On. Buddy hasn't read it yet.";
  final localizations = MaterialLocalizations.of(context);
  final date = localizations.formatFullDate(readAt);
  final time = localizations.formatTimeOfDay(TimeOfDay.fromDateTime(readAt));
  return 'On. Last read $date at $time.';
}

/// Everything Buddy can read for the Student, and how each one stands.
class ConnectionsScreen extends StatelessWidget {
  const ConnectionsScreen({super.key, required this.connections});

  final ConnectionsController connections;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: connections,
      builder: (context, _) {
        final list = connections.connections;
        return SubScreen(
          title: 'Connections',
          subtitle: 'What Buddy can read for you. Each one stays off until you give its Read Permission.',
          children: [
            if (connections.couldNotLoad)
              EmptyState(
                icon: Icons.link,
                isProblem: true,
                words: "Buddy couldn't load your Connections. Check that the backend is running.",
                action: AppLink('Try again', onPressed: connections.load),
              )
            else if (list == null)
              const LoadingBlock(label: 'Loading your Connections')
            else
              RowGroup(
                dividerIndent: 58,
                children: [for (final connection in list) _ConnectionRow(connection: connection, connections: connections)],
              ),
            if (connections.note case final note?) StatusNote(note, isProblem: connections.noteIsProblem),
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

  /// A Connection that's off only has its question to ask, unless something is still under way for it.
  bool get _hasItsOwnScreen =>
      connection.on || connection.notReadableYet != null || connection.loginNotDeletedYet || connections.takeoverSite == connection.id;

  void _open(BuildContext context) {
    Navigator.of(context).push(
      _hasItsOwnScreen
          ? MaterialPageRoute<void>(builder: (context) => ConnectionScreen(connectionId: connection.id, connections: connections))
          : MaterialPageRoute<void>(settings: workInProgress, builder: (context) => ReadPermissionScreen(connection: connection, connections: connections)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final hasProblem = connection.lastReadProblem != null || connection.loginNotDeletedYet;
    final needsYou = connection.needsLogin || connections.takeoverSite == connection.id;
    final status = needsYou ? 'Needs you to log in' : connectionStatus(context, connection);
    final words = [
      if (connection.service case final service?) '${service.domain}. ${service.routeInWords}.',
      status,
    ].join(' ');
    // When it needs a login, the problem only says that again in other words.
    final problem = connection.needsLogin ? null : connection.lastReadProblem;
    return NavRow(
      icon: needsYou || hasProblem ? Icons.warning_amber_rounded : connectionIcon(connection),
      iconColor: needsYou || hasProblem ? BuddyColors.warningInk : null,
      title: connection.name,
      subtitle: words,
      below: problem == null ? null : Text(problem, style: const TextStyle(color: BuddyColors.problem)),
      semanticsLabel: [
        '${connection.name}. $words',
        ?problem,
        if (connection.loginNotDeletedYet) "Buddy couldn't delete your login yet.",
      ].join(' '),
      onTap: () => _open(context),
    );
  }
}

/// One Connection that's on: how it stands, what to do about it, what Buddy reads from it, and the way to stop.
class ConnectionScreen extends StatelessWidget {
  const ConnectionScreen({super.key, required this.connectionId, required this.connections});

  final String connectionId;
  final ConnectionsController connections;

  /// Exactly what goes, which depends on what this Connection holds.
  String _whatRevokingDeletes(Connection connection) {
    if (connection.service != null) return "every fact from it and anything it holds to log in, including your login in Buddy's Browser, and takes it off your list";
    if (connection.logsIn) return "every fact from it and your login in Buddy's Browser";
    if (connection.card.address != null) return 'the address and every fact from it';
    return 'every fact from it';
  }

  Future<void> _revoke(BuildContext context, Connection connection) async {
    final navigator = Navigator.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        scrollable: true,
        title: Text('Revoke the Read Permission for ${connection.name}?'),
        content: Text(
          "Buddy stops reading ${connection.name}. This deletes ${_whatRevokingDeletes(connection)}. Whatever it already showed the AI stays in your conversation's history and in Activity until those are deleted, and Buddy is told not to use it.",
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: BuddyColors.problem),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Revoke'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await connections.revoke(connection);
    // Once it's gone there's nothing more to do here, and the list says what happened. If it hasn't all gone, this says why.
    if (!connections.noteIsProblem) navigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: connections,
      builder: (context, _) {
        final connection = connections.withId(connectionId);
        if (connection == null) return const SubScreen(children: []);
        final text = Theme.of(context).textTheme;
        final reading = connections.reading.contains(connection.id);
        final canAct = connection.notReadableYet == null;
        return SubScreen(
          topIcon: connectionIcon(connection),
          title: connection.name,
          subtitle: switch (connection.service) {
            final service? => '${service.domain}. ${service.routeInWords}.',
            null => null,
          },
          children: [
            Semantics(container: true, child: Text(connectionStatus(context, connection), style: text.titleMedium)),
            if (connection.needsLogin)
              const ProblemNote('Buddy needs you to log in before it can read this.')
            else if (connection.lastReadProblem case final problem?)
              ProblemNote(problem),
            if (connection.loginNotDeletedYet)
              const ProblemNote("Buddy couldn't delete your login yet, because Buddy's Browser couldn't be reached. Buddy can't use it, and keeps trying to delete it."),
            const SizedBox(height: 16),
            if (canAct && (connection.on || connections.takeoverSite == connection.id) && connection.logsIn) ...[
              LogInButton(connection: connection, connections: connections, prominent: connection.needsLogin),
              const SizedBox(height: 8),
            ],
            if (canAct && connection.on)
              OutlinedButton(
                onPressed: reading ? null : () => connections.read(connection),
                child: reading ? const Text('Reading…') : Text('Read now', semanticsLabel: 'Read ${connection.name} now'),
              ),
            if (connections.note case final note?) StatusNote(note, isProblem: connections.noteIsProblem),
            const SizedBox(height: 24),
            ScreenSection(
              title: 'What Buddy reads',
              children: [for (final line in connection.card.reads) Padding(padding: const EdgeInsets.only(top: 4), child: Text(line))],
            ),
            // The Student read all this before saying yes, so here it waits until it's wanted.
            if (connection.card.notes.isNotEmpty || connection.card.warning != null) ...[
              Expander(
                title: 'Good to know',
                children: [
                  if (connection.card.warning case final warning?)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                      child: NoticeCard(words: 'Warning: $warning'),
                    ),
                  for (final note in connection.card.notes)
                    Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: Text(note)),
                  const SizedBox(height: 16),
                ],
              ),
              const SizedBox(height: 24),
            ],
            // Revoking is also how the Student deletes a login they gave before Buddy stopped reading this.
            if (connection.on)
              OutlinedButton(
                style: OutlinedButton.styleFrom(foregroundColor: BuddyColors.problem, side: const BorderSide(color: BuddyColors.problem)),
                onPressed: () => _revoke(context, connection),
                child: Text('Revoke', semanticsLabel: 'Revoke the Read Permission for ${connection.name}'),
              ),
          ],
        );
      },
    );
  }
}
