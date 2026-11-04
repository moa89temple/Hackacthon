import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../design/parts.dart';
import '../design/theme.dart';
import 'chat_controller.dart';
import 'crisis_card.dart';

const _couldNotOpen = "Your phone couldn't open that.";
const _couldNotReport = "Buddy couldn't send your Report. Check that the backend is running, then try again.";

/// A Resource or Contact from the Guidebook, with its Source. Everything on it comes from the
/// backend's own record of the page, never from what Claude wrote.
class GuidebookCard extends StatelessWidget {
  const GuidebookCard({super.key, required this.card, required this.chat, required this.openPhone, required this.announce});

  final GuidebookCardItem card;
  final ChatController chat;
  final PhoneOpener openPhone;

  /// True when it has just appeared, so it should be read out.
  final bool announce;

  @override
  Widget build(BuildContext context) {
    final item = card.item;
    if (item == null) return _Gone(reportedJustNow: card.reportedJustNow);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      // It holds several controls, so it's a set of separate nodes rather than one.
      child: Card(
        semanticContainer: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: GuidebookItemBody(item: item, openPhone: openPhone, report: chat.report, announce: announce, showsName: true),
        ),
      ),
    );
  }
}

/// What's known about a Resource or Contact, and what can be done with it, wherever it's shown.
class GuidebookItemBody extends StatefulWidget {
  const GuidebookItemBody({
    super.key,
    required this.item,
    required this.openPhone,
    required this.report,
    this.announce = false,
    this.showsName = false,
    this.largeActions = false,
    this.onReported,
    this.extraAction,
  });

  final GuidebookItem item;
  final PhoneOpener openPhone;

  /// Throws if the Report didn't get there.
  final Future<void> Function(GuidebookItem item) report;
  final bool announce;

  /// On a screen, the name is already the title.
  final bool showsName;

  /// Calling or emailing is what the screen is for, so there they're full buttons.
  final bool largeActions;
  final VoidCallback? onReported;
  final Widget? extraAction;

  @override
  State<GuidebookItemBody> createState() => _GuidebookItemBodyState();
}

class _GuidebookItemBodyState extends State<GuidebookItemBody> {
  String? _problem;

  Future<void> _open(Uri address) async {
    bool opened;
    try {
      opened = await widget.openPhone(address);
    } on Exception {
      opened = false;
    }
    if (mounted) setState(() => _problem = opened ? null : _couldNotOpen);
  }

  Future<void> _report() async {
    final item = widget.item;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        scrollable: true,
        title: Text('Report ${item.name}?'),
        content: const Text(
          "Report it if it's wrong or out of date. Buddy will stop showing it to every Student, and this can't be undone.",
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: BuddyColors.problem),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Report'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.report(item);
      widget.onReported?.call();
    } on Exception {
      if (mounted) setState(() => _problem = _couldNotReport);
    }
  }

  Widget _action(String label, {required IconData icon, required String semanticsLabel, required VoidCallback onPressed, bool isFirst = false}) {
    final words = Text(label, semanticsLabel: semanticsLabel);
    if (widget.largeActions) {
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: isFirst
            ? FilledButton.icon(icon: Icon(icon), label: words, onPressed: onPressed)
            : OutlinedButton.icon(icon: Icon(icon), label: words, onPressed: onPressed),
      );
    }
    return Align(
      alignment: AlignmentDirectional.centerStart,
      child: TextButton.icon(
        style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 8)),
        icon: Icon(icon, size: 20),
        label: words,
        onPressed: onPressed,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final item = widget.item;
    final dial = item.phoneToDial;
    final lines = [
      item.summary,
      ?item.cost,
      if (item.phone case final phone? when dial == null) 'Phone: $phone',
      if (item.place case final place?) 'Where: $place',
      if (item.hours case final hours?) 'When: $hours',
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // One item, because on Android its lines otherwise run together with the buttons'.
        Semantics(
          container: true,
          liveRegion: widget.announce,
          label: 'Guidebook card: ${item.name}. ${lines.join('\n')}',
          excludeSemantics: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (widget.showsName) Padding(padding: const EdgeInsets.only(bottom: 2), child: Text(item.name, style: theme.textTheme.titleMedium)),
              for (final (index, line) in lines.indexed) Padding(padding: EdgeInsets.only(top: index == 0 ? 0 : 4), child: Text(line)),
            ],
          ),
        ),
        const SizedBox(height: 4),
        if (dial != null)
          _action(
            'Call ${item.phone}',
            icon: Icons.call_outlined,
            isFirst: true,
            semanticsLabel: 'Call ${item.name} at ${item.phone}',
            onPressed: () => _open(Uri.parse('tel:$dial')),
          ),
        if (item.email case final email?)
          _action(
            'Email $email',
            icon: Icons.mail_outline,
            isFirst: dial == null,
            semanticsLabel: 'Email ${item.name} at $email',
            onPressed: () => _open(Uri(scheme: 'mailto', path: email)),
          ),
        if (widget.extraAction case final action?) Padding(padding: const EdgeInsets.only(top: 8), child: action),
        const SizedBox(height: 4),
        SourceLinks(sources: item.sources, open: _open),
        if (_problem case final problem?) ProblemNote(problem),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton(
            style: TextButton.styleFrom(foregroundColor: BuddyColors.inkSoft, padding: EdgeInsets.zero),
            onPressed: _report,
            child: Text('Report', semanticsLabel: 'Report ${item.name} as wrong or out of date'),
          ),
        ),
      ],
    );
  }
}

/// In place of a card whose item isn't in the Guidebook any more.
class _Gone extends StatelessWidget {
  const _Gone({required this.reportedJustNow});

  final bool reportedJustNow;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      liveRegion: reportedJustNow,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(
          reportedJustNow
              ? 'You reported this, so Buddy no longer shows it to any Student.'
              : "Buddy no longer shows this card, because it was reported or it's gone from its Source.",
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ),
    );
  }
}
