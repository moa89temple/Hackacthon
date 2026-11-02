import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import 'profile_controller.dart';

/// The You tab's list of everything Buddy knows, where each fact came from, and the Student's
/// controls over each one.
class ProfileSection extends StatelessWidget {
  const ProfileSection({super.key, required this.profile});

  final ProfileController profile;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: profile,
      builder: (context, _) {
        final facts = profile.facts;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              header: true,
              child: Text('What Buddy knows about you', style: theme.textTheme.titleMedium),
            ),
            const SizedBox(height: 8),
            if (profile.couldNotLoad) ...[
              Semantics(
                liveRegion: true,
                child: const Text("The app can't reach Buddy right now. Check that the backend is running."),
              ),
              TextButton(onPressed: profile.load, child: const Text('Try again')),
            ] else if (facts == null)
              const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading what Buddy knows about you'))
            else if (facts.isEmpty)
              const Text('Nothing yet. What you tell Buddy will show up here, and you can change or delete it.')
            else ...[
              const Text('You can change or delete any of this.'),
              for (final fact in facts) _FactRow(fact: fact, profile: profile),
            ],
            if (profile.note case final note?)
              Semantics(
                container: true,
                liveRegion: true,
                child: Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(note, style: profile.noteIsProblem ? TextStyle(color: theme.colorScheme.error) : null),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _FactRow extends StatelessWidget {
  const _FactRow({required this.fact, required this.profile});

  final ProfileFact fact;
  final ProfileController profile;

  String _origin(BuildContext context) {
    final date = MaterialLocalizations.of(context).formatFullDate(fact.savedAt.toLocal());
    return '${fact.isFromConversation ? 'From your chat on' : 'Saved on'} $date.${fact.wasEdited ? ' You edited it.' : ''}';
  }

  Future<void> _edit(BuildContext context) async {
    final text = await showDialog<String>(
      context: context,
      builder: (context) => _EditFactDialog(text: fact.text),
    );
    if (text != null && text != fact.text) await profile.edit(fact, text);
  }

  Future<void> _delete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        scrollable: true,
        title: const Text('Delete this fact?'),
        content: Text(fact.text),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Delete')),
        ],
      ),
    );
    if (confirmed == true) await profile.delete(fact);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(fact.text),
          Text(_origin(context), style: theme.textTheme.bodySmall),
          // A Wrap, so that the buttons go on two lines when the text is large.
          Wrap(
            children: [
              TextButton(
                onPressed: () => _edit(context),
                // On their own, a Student using a screen reader would hear the same two words for every fact.
                child: Text('Edit', semanticsLabel: 'Edit: ${fact.text}'),
              ),
              TextButton(
                onPressed: () => _delete(context),
                child: Text('Delete', semanticsLabel: 'Delete: ${fact.text}'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _EditFactDialog extends StatefulWidget {
  const _EditFactDialog({required this.text});

  final String text;

  @override
  State<_EditFactDialog> createState() => _EditFactDialogState();
}

class _EditFactDialogState extends State<_EditFactDialog> {
  late final _draft = TextEditingController(text: widget.text);

  @override
  void dispose() {
    _draft.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      scrollable: true,
      title: const Text('Edit this fact'),
      content: TextField(
        controller: _draft,
        autofocus: true,
        minLines: 1,
        maxLines: 5,
        keyboardType: TextInputType.multiline,
        textCapitalization: TextCapitalization.sentences,
        decoration: const InputDecoration(labelText: 'Fact', border: OutlineInputBorder()),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        ValueListenableBuilder(
          valueListenable: _draft,
          builder: (context, value, _) => TextButton(
            onPressed: value.text.trim().isEmpty ? null : () => Navigator.of(context).pop(_draft.text.trim()),
            child: const Text('Save'),
          ),
        ),
      ],
    );
  }
}
