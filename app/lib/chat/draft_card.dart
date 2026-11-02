import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../backend/buddy_backend.dart';
import 'chat_controller.dart';
import 'draft_edit_screen.dart';
import 'outlook.dart';

const _otherRoute = "Rather not write to them? Ask me and I'll explain the issue myself.";
const _noAddress = "Buddy doesn't have an email address for them, so add it in Outlook.";
const _contactGone =
    "Buddy no longer shows who this was for, because they were reported or they've gone from their Source. Add who it's to in Outlook.";
const _opened = 'Check that it comes from your TUmail, then send it yourself.';
const _alsoCopied = 'Buddy also copied the message, so you can paste it in if it isn\'t filled in.';
const _couldNotOpen = "Your phone couldn't open Outlook.";
const _pasteInstead = 'Buddy copied the message, so you can paste it into a new TUmail email.';
const _copied = 'Copied the message.';
const _couldNotCopy = "Buddy couldn't copy the message. Try again, or open Edit and copy it from there.";
const _saved = 'Your changes are saved.';

/// A Draft for the Student to send themselves. Nothing here tells the backend when it's opened or
/// copied, because what the Student does with their email is their own business.
class DraftCard extends StatefulWidget {
  const DraftCard({super.key, required this.card, required this.chat, required this.openDraft, required this.announce});

  final DraftCardItem card;
  final ChatController chat;
  final DraftOpener openDraft;

  /// True when it has just appeared, so it should be read out.
  final bool announce;

  @override
  State<DraftCard> createState() => _DraftCardState();
}

class _DraftCardState extends State<DraftCard> {
  /// What just happened, for the Student to read. It lasts until the next tap.
  String? _status;
  bool _statusIsProblem = false;

  Draft get _draft => widget.card.draft;

  void _say(String status, {bool problem = false}) {
    if (!mounted) return;
    setState(() {
      _status = status;
      _statusIsProblem = problem;
    });
  }

  Future<bool> _copyMessage() async {
    try {
      await Clipboard.setData(ClipboardData(text: _draft.body));
      return true;
    } on Exception {
      return false;
    }
  }

  Future<void> _copy() async {
    final copied = await _copyMessage();
    _say(copied ? _copied : _couldNotCopy, problem: !copied);
  }

  /// The address on the web is too short for a long message, and neither way of opening an email can
  /// be checked from here once it has left Buddy, so the message is always ready to paste.
  Future<void> _openInOutlook() async {
    final copied = await _copyMessage();
    final email = OutlookEmail(to: _draft.contact?.email, subject: _draft.subject, body: _draft.body);
    bool opened;
    try {
      opened = await widget.openDraft(email);
    } on Exception {
      opened = false;
    }
    if (opened) {
      _say(copied ? '$_opened $_alsoCopied' : _opened);
    } else {
      _say(copied ? '$_couldNotOpen $_pasteInstead' : _couldNotOpen, problem: true);
    }
  }

  Future<void> _edit() async {
    final saved = await Navigator.of(context).push<SavedDraft>(
      MaterialPageRoute(
        builder: (context) => DraftEditScreen(
          draft: _draft,
          onSave: (subject, body) => widget.chat.editDraft(_draft.id, subject: subject, body: body),
        ),
      ),
    );
    if (saved != null) _say(saved.hiddenNote ?? _saved);
  }

  Widget _button(String label, {required String semanticsLabel, required VoidCallback onPressed}) {
    return TextButton(onPressed: onPressed, child: Text(label, semanticsLabel: semanticsLabel));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final draft = _draft;
    final name = draft.contact?.name;
    final email = draft.contact?.email;
    final title = name == null ? 'Draft' : 'Draft to $name';
    final subject = 'Subject: ${draft.subject}';
    final why = 'Why them: ${draft.why}';
    final lines = [
      if (name == null) _contactGone else if (email == null) _noAddress else 'To: $email',
      why,
      subject,
      draft.body,
    ];
    return Card(
      // It holds several controls, so it's a set of separate nodes rather than one.
      semanticContainer: false,
      margin: const EdgeInsets.symmetric(vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // One item, because on Android its lines otherwise run together with the buttons'.
            Semantics(
              container: true,
              liveRegion: widget.announce,
              label: '$title. ${lines.join('\n')}',
              excludeSemantics: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: theme.textTheme.titleMedium),
                  for (final line in lines.take(3)) Padding(padding: const EdgeInsets.only(top: 4), child: Text(line)),
                  const Divider(height: 20),
                  Text(draft.body),
                ],
              ),
            ),
            const SizedBox(height: 4),
            // Wraps onto new lines rather than running off the edge when text is large.
            Wrap(
              children: [
                _button(
                  'Edit',
                  semanticsLabel: name == null ? 'Edit the Draft' : 'Edit the Draft to $name',
                  onPressed: _edit,
                ),
                _button(
                  'Open in Outlook',
                  semanticsLabel: name == null ? 'Open the Draft in Outlook' : 'Open the Draft to $name in Outlook',
                  onPressed: _openInOutlook,
                ),
                _button(
                  'Copy',
                  semanticsLabel: name == null ? 'Copy the Draft' : 'Copy the Draft to $name',
                  onPressed: _copy,
                ),
              ],
            ),
            if (_status case final status?)
              Semantics(
                container: true,
                liveRegion: true,
                child: Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(status, style: _statusIsProblem ? TextStyle(color: theme.colorScheme.error) : null),
                ),
              ),
            Semantics(
              container: true,
              child: Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_otherRoute, style: theme.textTheme.bodySmall),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
