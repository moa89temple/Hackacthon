import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import 'connections_controller.dart';

/// Says exactly what Buddy will read. Everything on it comes from Buddy's code by way of the
/// backend, never from the model, and only a tap here gives the Read Permission.
class ReadPermissionCard extends StatefulWidget {
  const ReadPermissionCard({super.key, required this.connection, required this.connections, this.onGiven});

  final Connection connection;
  final ConnectionsController connections;

  /// Called once the Read Permission is given, for a screen that should then close.
  final VoidCallback? onGiven;

  @override
  State<ReadPermissionCard> createState() => _ReadPermissionCardState();
}

class _ReadPermissionCardState extends State<ReadPermissionCard> {
  final _address = TextEditingController();
  bool _giving = false;
  String? _problem;

  @override
  void dispose() {
    _address.dispose();
    super.dispose();
  }

  Future<void> _give() async {
    setState(() {
      _giving = true;
      _problem = null;
    });
    final needsAddress = widget.connection.card.address != null;
    try {
      await widget.connections.give(widget.connection, needsAddress ? _address.text.trim() : null);
      if (!mounted) return;
      widget.onGiven?.call();
    } on ReadPermissionRefused catch (refusal) {
      if (mounted) setState(() => _problem = refusal.message);
    } on Exception {
      if (mounted) setState(() => _problem = ConnectionsController.couldNotReach);
    } finally {
      if (mounted) setState(() => _giving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final content = widget.connection.card;
    final address = content.address;
    return Card(
      // It holds several headings and controls, so it's a set of separate nodes rather than one.
      semanticContainer: false,
      margin: const EdgeInsets.symmetric(vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              header: true,
              child: Text('Let Buddy read ${widget.connection.name}?', style: theme.textTheme.titleMedium),
            ),
            const SizedBox(height: 12),
            _Heading('What Buddy will read'),
            for (final line in content.reads) _Line(line),
            if (content.warning case final warning?)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: DecoratedBox(
                  decoration: BoxDecoration(color: colors.errorContainer, borderRadius: BorderRadius.circular(8)),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text('Warning: $warning', style: TextStyle(color: colors.onErrorContainer)),
                  ),
                ),
              ),
            const SizedBox(height: 12),
            _Heading('Good to know'),
            for (final line in content.notes) _Line(line),
            if (address != null) ...[
              const SizedBox(height: 12),
              _Heading('How to find the address'),
              for (final (index, step) in address.steps.indexed) _Line('${index + 1}. $step'),
              const SizedBox(height: 12),
              TextField(
                controller: _address,
                minLines: 1,
                maxLines: 3,
                autocorrect: false,
                enableSuggestions: false,
                keyboardType: TextInputType.url,
                decoration: InputDecoration(labelText: address.label, border: const OutlineInputBorder()),
              ),
            ],
            if (_problem case final problem?)
              Semantics(
                container: true,
                liveRegion: true,
                child: Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(problem, style: TextStyle(color: colors.error)),
                ),
              ),
            const SizedBox(height: 12),
            ListenableBuilder(
              listenable: _address,
              builder: (context, _) => FilledButton(
                onPressed: !_giving && (address == null || _address.text.trim().isNotEmpty) ? _give : null,
                child: Text(_giving ? 'Connecting…' : 'Give Read Permission'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) =>
      Semantics(header: true, child: Text(text, style: Theme.of(context).textTheme.titleSmall));
}

class _Line extends StatelessWidget {
  const _Line(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(top: 4), child: Text(text));
}

/// The card in the conversation, where Buddy suggested the Connection. It follows the Connection's
/// real state, because the Student may have connected or revoked it since.
class ConversationReadPermissionCard extends StatelessWidget {
  const ConversationReadPermissionCard({super.key, required this.connectionId, required this.connections, required this.announce});

  final String connectionId;
  final ConnectionsController connections;

  /// True when it has just appeared, so it should be read out.
  final bool announce;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: connections,
      builder: (context, _) {
        final connection = connections.withId(connectionId);
        if (connection == null) {
          if (!connections.couldNotLoad) return const SizedBox.shrink();
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text("Buddy suggested connecting something here, but the app couldn't load the card."),
              TextButton(onPressed: connections.load, child: const Text('Try again')),
            ],
          );
        }
        return Semantics(
          container: true,
          liveRegion: announce,
          child: connection.on
              ? Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text('${connection.name} is connected. You can revoke this on the You tab.'),
                )
              : ReadPermissionCard(connection: connection, connections: connections),
        );
      },
    );
  }
}

/// The card on its own screen, when the Student goes to connect something from the You tab.
class ReadPermissionScreen extends StatelessWidget {
  const ReadPermissionScreen({super.key, required this.connection, required this.connections});

  final Connection connection;
  final ConnectionsController connections;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Connect ${connection.name}')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            ReadPermissionCard(
              connection: connection,
              connections: connections,
              onGiven: () => Navigator.of(context).pop(),
            ),
          ],
        ),
      ),
    );
  }
}
