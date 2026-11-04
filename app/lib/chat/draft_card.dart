import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../backend/buddy_backend.dart';
import '../design/parts.dart';
import '../widgets/work_in_progress.dart';
import 'chat_controller.dart';
import 'draft_edit_screen.dart';
import 'outlook.dart';

const _otherRoute = 'Rather not write to anyone? Ask Buddy, and it will explain the issue itself.';
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
const _buddySends = 'Buddy sends it shows you exactly what will go and to whom, and nothing goes until you tap Approve.';
const _cardMade = 'Buddy made a card for you to check and approve. It\'s the newest thing in the conversation.';
const _couldNotAsk = "The app couldn't reach Buddy, so it made no card. Check that the backend is running, then try again.";

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
    final saved = await Navigator.of(context).push<DraftSaved>(
      MaterialPageRoute(
        settings: workInProgress,
        builder: (context) => DraftEditScreen(
          draft: _draft,
          onSave: (subject, body) => widget.chat.editDraft(_draft.id, subject: subject, body: body),
        ),
      ),
    );
    if (saved != null) _say(saved.hiddenNote ?? _saved);
  }

  /// Only ever makes a card. The email goes only if the Student taps Approve on it.
  Future<void> _askBuddyToSend() async {
    try {
      final refusal = await widget.chat.askForSendCard(_draft);
      _say(refusal ?? _cardMade, problem: refusal != null);
    } on Exception {
      _say(_couldNotAsk, problem: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final draft = _draft;
    final name = draft.contact?.name;
    final email = draft.contact?.email;
    final title = name == null ? 'Draft' : 'Draft to $name';
    final theDraft = name == null ? 'the Draft' : 'the Draft to $name';
    final details = [
      if (name == null) _contactGone else if (email == null) _noAddress else 'To: $email',
      if (draft.why case final why?) 'Why them: $why',
      'Subject: ${draft.subject}',
    ];
    final openInOutlook = Text('Open in Outlook', semanticsLabel: 'Open $theDraft in Outlook');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Card(
        // It holds several controls, so it's a set of separate nodes rather than one.
        semanticContainer: false,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // One item, because on Android its lines otherwise run together with the buttons'.
              Semantics(
                container: true,
                liveRegion: widget.announce,
                label: '$title. ${[...details, draft.body].join('\n')}',
                excludeSemantics: true,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: theme.textTheme.titleLarge),
                    for (final line in details) Padding(padding: const EdgeInsets.only(top: 4), child: Text(line)),
                    const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Divider()),
                    Text(draft.body),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              // What sends it comes first, stacked so that large text never squeezes them.
              if (email != null) ...[
                FilledButton(
                  onPressed: _askBuddyToSend,
                  child: Text('Buddy sends it', semanticsLabel: 'Buddy sends it: $theDraft'),
                ),
                const SizedBox(height: 8),
                OutlinedButton(onPressed: _openInOutlook, child: openInOutlook),
              ] else
                FilledButton(onPressed: _openInOutlook, child: openInOutlook),
              const SizedBox(height: 4),
              // Wraps onto new lines rather than running off the edge when text is large.
              Wrap(
                spacing: 16,
                children: [
                  AppLink('Edit', icon: Icons.edit_outlined, semanticsLabel: 'Edit $theDraft', onPressed: _edit),
                  AppLink('Copy', icon: Icons.copy_outlined, semanticsLabel: 'Copy $theDraft', onPressed: _copy),
                ],
              ),
              if (_status case final status?) StatusNote(status, isProblem: _statusIsProblem),
              Semantics(
                container: true,
                child: Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(_otherRoute, style: theme.textTheme.bodySmall),
                ),
              ),
              if (email != null)
                Semantics(
                  container: true,
                  child: Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(_buddySends, style: theme.textTheme.bodySmall),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
