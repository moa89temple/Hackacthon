import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../design/parts.dart';
import '../design/theme.dart';
import 'profile_controller.dart';

/// A group this long starts closed, so that a read of Canvas doesn't bury what the Student said themselves.
const _longestGroupLeftOpen = 5;
const _fromYourChat = 'From your chat';
const _savedOtherWays = 'Saved';
const _keptInActivity = 'Activity keeps a copy with any reply that saved it or had it.';

/// Everything Buddy knows, where each fact came from, and the Student's controls over each one.
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key, required this.profile});

  final ProfileController profile;

  /// What the Student said themselves comes first, then each Connection, in the order they first appear.
  Map<String, List<ProfileFact>> _grouped(List<ProfileFact> facts) {
    final groups = <String, List<ProfileFact>>{_fromYourChat: [], _savedOtherWays: []};
    for (final fact in facts) {
      final group = switch (fact.connectionName) {
        final String name => 'From $name',
        null => fact.isFromConversation ? _fromYourChat : _savedOtherWays,
      };
      groups.putIfAbsent(group, () => []).add(fact);
    }
    return groups..removeWhere((_, group) => group.isEmpty);
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: profile,
      builder: (context, _) {
        final facts = profile.facts;
        return SubScreen(
          title: 'What Buddy knows about you',
          subtitle: facts == null || facts.isEmpty ? null : 'You can change or delete any of this.',
          children: [
            if (profile.couldNotLoad)
              EmptyState(
                icon: Icons.person_outline,
                isProblem: true,
                words: "The app can't reach Buddy right now. Check that the backend is running.",
                action: AppLink('Try again', onPressed: profile.load),
              )
            else if (facts == null)
              const LoadingBlock(label: 'Loading what Buddy knows about you')
            else if (facts.isEmpty)
              const EmptyState(
                icon: Icons.person_outline,
                words: 'Nothing yet. What you tell Buddy will show up here, and you can change or delete it.',
              )
            else
              for (final MapEntry(key: name, value: group) in _grouped(facts).entries) ...[
                Expander(
                  title: name,
                  trailing: '${group.length}',
                  startsOpen: group.length <= _longestGroupLeftOpen,
                  children: [
                    for (final (index, fact) in group.indexed) ...[
                      if (index > 0) const Divider(indent: 16, endIndent: 16),
                      _FactRow(key: ValueKey('fact ${fact.id}'), fact: fact, profile: profile),
                    ],
                  ],
                ),
                const SizedBox(height: 12),
              ],
            if (profile.note case final note?) StatusNote(note, isProblem: profile.noteIsProblem),
          ],
        );
      },
    );
  }
}

class _FactRow extends StatelessWidget {
  const _FactRow({super.key, required this.fact, required this.profile});

  final ProfileFact fact;
  final ProfileController profile;

  String _origin(BuildContext context) {
    final date = MaterialLocalizations.of(context).formatFullDate(fact.savedAt.toLocal());
    final source = switch (fact.connectionName) {
      final String name => 'From $name, read on',
      null => fact.isFromConversation ? 'From your chat on' : 'Saved on',
    };
    return '$source $date.${fact.wasEdited ? ' You edited it.' : ''}';
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
        content: Text(switch (fact.connectionName) {
          final String name => '${fact.text}\n\nIt stays deleted when Buddy reads $name again. $_keptInActivity',
          null => '${fact.text}\n\n$_keptInActivity',
        }),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: BuddyColors.problem),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed == true) await profile.delete(fact);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 4, 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            // One item, because on Android the facts otherwise run together with the heading.
            child: MergeSemantics(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(fact.text),
                    if (fact.detail case final detail?) Text(detail),
                    Text(_origin(context), style: theme.textTheme.bodySmall),
                  ],
                ),
              ),
            ),
          ),
          RowMenu(
            // On their own, a Student using a screen reader would hear the same words for every fact.
            tooltip: 'Change or delete: ${fact.text}',
            items: [
              RowMenuItem('Edit', semanticsLabel: 'Edit: ${fact.text}', onSelected: () => _edit(context)),
              RowMenuItem('Delete', semanticsLabel: 'Delete: ${fact.text}', onSelected: () => _delete(context)),
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
        decoration: const InputDecoration(labelText: 'Fact'),
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
