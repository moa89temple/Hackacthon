import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import 'chat_controller.dart';
import 'crisis_card.dart';

const _couldNotOpen = "Your phone couldn't open that.";
const _couldNotReport = "Buddy couldn't send your Report. Check that the backend is running, then try again.";
const _mostSourcesShown = 3;

/// A Resource or Contact from the Guidebook, with its Source. Everything on it comes from the
/// backend's own record of the page, never from what Claude wrote.
class GuidebookCard extends StatefulWidget {
  const GuidebookCard({super.key, required this.card, required this.chat, required this.openPhone, required this.announce});

  final GuidebookCardItem card;
  final ChatController chat;
  final PhoneOpener openPhone;

  /// True when it has just appeared, so it should be read out.
  final bool announce;

  @override
  State<GuidebookCard> createState() => _GuidebookCardState();
}

class _GuidebookCardState extends State<GuidebookCard> {
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

  Future<void> _report(GuidebookItem item) async {
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
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Report')),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.chat.report(item);
    } on Exception {
      if (mounted) setState(() => _problem = _couldNotReport);
    }
  }

  Widget _link(String label, {required String semanticsLabel, required VoidCallback? onPressed}) {
    return TextButton(
      style: TextButton.styleFrom(alignment: AlignmentDirectional.centerStart),
      onPressed: onPressed,
      child: Text(label, semanticsLabel: semanticsLabel),
    );
  }

  Widget _source(BuildContext context, GuidebookSource source) {
    final address = Uri.tryParse(source.url);
    final lastSeen = MaterialLocalizations.of(context).formatFullDate(source.lastSeenAt.toLocal());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _link(
          'Source: ${source.title}',
          semanticsLabel: 'Open Source: ${source.title}, last seen $lastSeen',
          onPressed: address?.scheme == 'https' ? () => _open(address!) : null,
        ),
        ExcludeSemantics(child: Text('Last seen $lastSeen', style: Theme.of(context).textTheme.bodySmall)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.card.item;
    if (item == null) return _Gone(reportedJustNow: widget.card.reportedJustNow);

    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final dial = item.phoneToDial;
    final moreSources = item.sources.length - _mostSourcesShown;
    final lines = [
      item.summary,
      ?item.cost,
      if (item.phone case final phone? when dial == null) 'Phone: $phone',
      if (item.place case final place?) 'Where: $place',
      if (item.hours case final hours?) 'When: $hours',
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
              label: 'Guidebook card: ${item.name}. ${lines.join('\n')}',
              excludeSemantics: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.name, style: theme.textTheme.titleMedium),
                  for (final line in lines) Padding(padding: const EdgeInsets.only(top: 4), child: Text(line)),
                ],
              ),
            ),
            const SizedBox(height: 4),
            if (dial != null)
              _link(
                'Call ${item.phone}',
                semanticsLabel: 'Call ${item.name} at ${item.phone}',
                onPressed: () => _open(Uri.parse('tel:$dial')),
              ),
            if (item.email case final email?)
              _link(
                'Email $email',
                semanticsLabel: 'Email ${item.name} at $email',
                onPressed: () => _open(Uri(scheme: 'mailto', path: email)),
              ),
            for (final source in item.sources.take(_mostSourcesShown)) _source(context, source),
            if (moreSources > 0)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text('Also on $moreSources more of its pages.', style: theme.textTheme.bodySmall),
              ),
            if (_problem case final problem?)
              Semantics(
                container: true,
                liveRegion: true,
                child: Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(problem, style: TextStyle(color: colors.error)),
                ),
              ),
            _link(
              'Report',
              semanticsLabel: 'Report ${item.name} as wrong or out of date',
              onPressed: () => _report(item),
            ),
          ],
        ),
      ),
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
