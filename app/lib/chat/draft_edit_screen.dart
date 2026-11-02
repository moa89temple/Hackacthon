import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';

const _couldNotSave = "Buddy couldn't save your changes. Check that the backend is running, then try again.";

/// What came of saving, for the card to say.
class SavedDraft {
  const SavedDraft({this.hiddenNote});

  /// What to tell the Student if something they typed was hidden.
  final String? hiddenNote;
}

/// A whole screen rather than a dialog, so that a long message has room at any text size.
class DraftEditScreen extends StatefulWidget {
  const DraftEditScreen({super.key, required this.draft, required this.onSave});

  final Draft draft;

  /// Returns what to tell the Student about what was hidden. Throws if it couldn't save.
  final Future<String?> Function(String subject, String body) onSave;

  @override
  State<DraftEditScreen> createState() => _DraftEditScreenState();
}

class _DraftEditScreenState extends State<DraftEditScreen> {
  late final _subject = TextEditingController(text: widget.draft.subject);
  late final _message = TextEditingController(text: widget.draft.body);
  bool _saving = false;
  bool _couldNot = false;

  @override
  void dispose() {
    _subject.dispose();
    _message.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _couldNot = false;
    });
    try {
      final hiddenNote = await widget.onSave(_subject.text.trim(), _message.text.trim());
      if (mounted) Navigator.of(context).pop(SavedDraft(hiddenNote: hiddenNote));
    } on Exception {
      if (mounted) {
        setState(() {
          _saving = false;
          _couldNot = true;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Semantics(header: true, child: const Text('Edit Draft')),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  TextField(
                    controller: _subject,
                    keyboardType: TextInputType.text,
                    textCapitalization: TextCapitalization.sentences,
                    maxLines: null,
                    decoration: const InputDecoration(labelText: 'Subject', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _message,
                    minLines: 8,
                    maxLines: null,
                    keyboardType: TextInputType.multiline,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(labelText: 'Message', border: OutlineInputBorder(), alignLabelWithHint: true),
                  ),
                  const SizedBox(height: 8),
                  const Text('If the last line says Buddy helped write this, you can delete it.'),
                ],
              ),
            ),
            // Outside the list, so that it stays above the keyboard however long the message is.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_couldNot)
                    Semantics(
                      container: true,
                      liveRegion: true,
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Text(_couldNotSave, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                      ),
                    ),
                  Wrap(
                    spacing: 8,
                    children: [
                      ValueListenableBuilder(
                        valueListenable: _message,
                        builder: (context, value, _) => FilledButton(
                          onPressed: value.text.trim().isEmpty || _saving ? null : _save,
                          child: const Text('Save'),
                        ),
                      ),
                      TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
