import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../design/parts.dart';
import '../design/theme.dart';
import '../widgets/work_in_progress.dart';
import 'connections_controller.dart';
import 'connections_section.dart';
import 'login_request.dart';

/// Says exactly what Buddy will read. Everything on it comes from Buddy's code by way of the
/// backend, never from the model, and only a tap here gives the Read Permission. It's a whole screen, wherever it
/// starts, because it's a lot to read and a decision that lasts until it's revoked.
class ReadPermissionScreen extends StatefulWidget {
  const ReadPermissionScreen({super.key, required this.connection, required this.connections});

  final Connection connection;
  final ConnectionsController connections;

  @override
  State<ReadPermissionScreen> createState() => _ReadPermissionScreenState();
}

class _ReadPermissionScreenState extends State<ReadPermissionScreen> {
  final _address = TextEditingController();
  bool _giving = false;
  bool _given = false;
  bool _addressIsHidden = true;
  String? _problem;

  @override
  void dispose() {
    _address.dispose();
    super.dispose();
  }

  Connection get _connection => widget.connections.withId(widget.connection.id) ?? widget.connection;

  Future<void> _give() async {
    setState(() {
      _giving = true;
      _problem = null;
    });
    final needsAddress = _connection.card.address != null;
    try {
      await widget.connections.give(_connection, needsAddress ? _address.text.trim() : null);
      if (!mounted) return;
      // A login is the rest of saying yes, so it comes next, rather than something to go and find.
      if (_connection.needsLogin) {
        setState(() => _given = true);
      } else {
        Navigator.of(context).pop();
      }
    } on ReadPermissionRefused catch (refusal) {
      if (mounted) setState(() => _problem = refusal.message);
    } on Exception {
      if (mounted) setState(() => _problem = ConnectionsController.couldNotReach);
    } finally {
      if (mounted) setState(() => _giving = false);
    }
  }

  Future<void> _remove() async {
    final navigator = Navigator.of(context);
    await widget.connections.remove(_connection);
    navigator.pop();
  }

  /// Back from the live view. If that's settled, there's nothing left to do here.
  void _backFromLogin() {
    if (!mounted) return;
    final connection = _connection;
    if (!connection.needsLogin && widget.connections.takeoverSite == null) Navigator.of(context).pop();
  }

  Widget _heading(String words) => Semantics(header: true, container: true, child: Text(words, style: Theme.of(context).textTheme.titleLarge));

  Widget _line(String words) => Padding(padding: const EdgeInsets.only(top: 6), child: Text(words));

  Widget _addressPart(AddressRequest address) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _heading('Secret calendar address'),
        _line('Keep this address private.'),
        const SizedBox(height: 10),
        TextField(
          controller: _address,
          obscureText: _addressIsHidden,
          autocorrect: false,
          enableSuggestions: false,
          keyboardType: TextInputType.url,
          decoration: InputDecoration(
            labelText: address.label,
            suffixIcon: TextButton(
              onPressed: () => setState(() => _addressIsHidden = !_addressIsHidden),
              child: Text(
                _addressIsHidden ? 'Show' : 'Hide',
                semanticsLabel: _addressIsHidden ? 'Show the address' : 'Hide the address',
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        Expander(
          title: 'How to find this address',
          children: [
            for (final (index, step) in address.steps.indexed)
              Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: Text('${index + 1}. $step')),
            const SizedBox(height: 16),
          ],
        ),
        const SizedBox(height: 24),
      ],
    );
  }

  /// It's on, but the answer to the tap never came, so only the list could say so.
  Widget _connectedStep(Connection connection) {
    return SubScreen(
      topIcon: Icons.check_circle_outline,
      title: '${connection.name} is connected',
      children: [
        FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Done')),
      ],
    );
  }

  Widget _loginStep(Connection connection) {
    final connections = widget.connections;
    return SubScreen(
      topIcon: Icons.lock_open_outlined,
      title: '${connection.name} is connected',
      subtitle: 'One more step: log in so that Buddy can read it. You log in yourself, and Buddy never learns your password.',
      children: [
        LogInButton(connection: connection, connections: connections, prominent: true, onFinished: _backFromLogin),
        const SizedBox(height: 8),
        OutlinedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Not now')),
        // The title already says it's connected, so only what went wrong needs saying here.
        if (connections.noteIsProblem)
          if (connections.note case final note?) ProblemNote(note),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.connections,
      builder: (context, _) {
        final connection = _connection;
        if (_given || connection.needsLogin) return _loginStep(connection);
        if (connection.on) return _connectedStep(connection);
        final content = connection.card;
        return SubScreen(
          topIcon: connectionIcon(connection),
          title: 'Let Buddy read ${connection.name}?',
          subtitle: content.why,
          children: [
            if (connection.service case final service?) ...[
              _heading('The service'),
              _line('Name: ${connection.name}'),
              _line('Web address: ${service.domain}'),
              _line('How Buddy reads it: ${service.routeInWords}.'),
              const SizedBox(height: 24),
            ],
            _heading('What Buddy will read'),
            for (final line in content.reads) _line(line),
            const SizedBox(height: 16),
            // Above the notes, so that it can't be missed on the way to the button.
            if (content.warning case final warning?) ...[
              NoticeCard(words: 'Warning: $warning'),
              const SizedBox(height: 24),
            ],
            _heading('Ongoing access'),
            _line('This Read Permission stays on until you revoke it.'),
            const SizedBox(height: 24),
            if (content.notes.isNotEmpty) ...[
              DecoratedBox(
                decoration: BoxDecoration(
                  border: Border.all(color: BuddyColors.hairline),
                  borderRadius: BorderRadius.circular(BuddySizes.cardRadius),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Semantics(header: true, container: true, child: Text('Good to know', style: Theme.of(context).textTheme.titleMedium)),
                      for (final note in content.notes) Padding(padding: const EdgeInsets.only(top: 10), child: Text(note)),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 24),
            ],
            if (content.address case final address?) _addressPart(address),
            _heading('You stay in control'),
            _line('You can revoke this in You > Connections.'),
            if (_problem case final problem?) ProblemNote(problem),
            const SizedBox(height: 20),
            ListenableBuilder(
              listenable: _address,
              builder: (context, _) => FilledButton(
                onPressed: !_giving && (content.address == null || _address.text.trim().isNotEmpty) ? _give : null,
                child: Text(_giving ? 'Connecting…' : 'Give Read Permission'),
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Not now')),
            // It's on the list only because the Student asked, so they can change their mind.
            if (connection.service != null)
              Align(
                child: TextButton(
                  style: TextButton.styleFrom(foregroundColor: BuddyColors.inkSoft),
                  onPressed: _remove,
                  child: Text('Remove', semanticsLabel: 'Remove ${connection.name} from your list'),
                ),
              ),
          ],
        );
      },
    );
  }
}

/// The card in the conversation, where Buddy suggested the Connection. It follows the Connection's
/// real state, because the Student may have connected or revoked it since. The decision itself is on its own screen,
/// so that a long read doesn't take over the conversation.
class ConversationReadPermissionCard extends StatelessWidget {
  const ConversationReadPermissionCard({super.key, required this.connectionId, required this.connections, required this.announce});

  final String connectionId;
  final ConnectionsController connections;

  /// True when it has just appeared, so it should be read out.
  final bool announce;

  void _openScreen(BuildContext context, Connection connection) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        settings: workInProgress,
        builder: (context) => ReadPermissionScreen(connection: connection, connections: connections),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: connections,
      builder: (context, _) {
        final connection = connections.withId(connectionId);
        if (connection == null) {
          if (!connections.couldNotLoad) {
            // Asking while this is being drawn would ask to draw it again.
            WidgetsBinding.instance.addPostFrameCallback((_) => connections.lookFor(connectionId));
            return const SizedBox.shrink();
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text("Buddy suggested connecting something here, but the app couldn't load the card."),
              AppLink('Try again', onPressed: connections.load),
            ],
          );
        }
        return Semantics(
          container: true,
          liveRegion: announce,
          child: connection.on
              ? connection.needsLogin
                  ? Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        LoginRequest(connection: connection, connections: connections),
                        LoginProblem(connections: connections),
                      ],
                    )
                  : Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const ExcludeSemantics(child: Icon(Icons.check_circle_outline, color: BuddyColors.good)),
                          const SizedBox(width: 8),
                          Expanded(child: Text('${connection.name} is connected. You can revoke this in You > Connections.')),
                        ],
                      ),
                    )
              : _Question(connection: connection, onReview: () => _openScreen(context, connection)),
        );
      },
    );
  }
}

/// Buddy's suggestion in short. Nothing is decided here, only on the screen it opens.
class _Question extends StatelessWidget {
  const _Question({required this.connection, required this.onReview});

  final Connection connection;
  final VoidCallback onReview;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Card(
        // It holds a heading and a button, so it's a set of separate nodes rather than one.
        semanticContainer: false,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  IconTile(connectionIcon(connection), size: 48),
                  const SizedBox(width: 12),
                  Expanded(child: Semantics(header: true, container: true, child: Text('Let Buddy read ${connection.name}?', style: text.titleLarge))),
                ],
              ),
              const SizedBox(height: 10),
              if (connection.card.why case final why?) Padding(padding: const EdgeInsets.only(bottom: 4), child: Text(why)),
              const Text('See exactly what it would read, then decide. Nothing is read until you say yes.'),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: onReview,
                child: Text('Review and decide', semanticsLabel: 'Review and decide: let Buddy read ${connection.name}'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
