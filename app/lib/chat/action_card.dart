import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import 'chat_controller.dart';

const _couldNotApprove =
    "The app couldn't reach Buddy, so it may or may not have started. It's safe to tap Approve again: Buddy won't do it twice.";
const _couldNotReach = "The app couldn't reach Buddy. Check that the backend is running, then try again.";

/// Shows exactly what will happen, and asks for the Student's tap. Everything on it comes from the
/// backend's own record of the card, never from what Claude wrote in the chat, and Approve is the only
/// thing in the app that can give an Action Permission.
class ActionCardView extends StatefulWidget {
  const ActionCardView({super.key, required this.card, required this.chat, required this.announce});

  final ActionCard card;
  final ChatController chat;

  /// True when it has just appeared, so it should be read out.
  final bool announce;

  @override
  State<ActionCardView> createState() => _ActionCardViewState();
}

class _ActionCardViewState extends State<ActionCardView> {
  String? _problem;

  /// True once the Student has tapped here, so that what became of the tap is read out.
  bool _tapped = false;

  Future<void> _tap(Future<String?> Function() tap, String couldNotReach) async {
    setState(() {
      _tapped = true;
      _problem = null;
    });
    String? problem;
    try {
      problem = await tap();
    } on Exception {
      problem = couldNotReach;
    }
    if (mounted) setState(() => _problem = problem);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final card = widget.card;
    final chat = widget.chat;
    final busy = chat.isBeingDecided(card);
    final lines = [for (final line in card.shows) '${line.label}: ${line.value}', ?card.note];
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
              label: 'Action card: ${card.title}.\n${lines.join('\n')}',
              excludeSemantics: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(card.title, style: theme.textTheme.titleMedium),
                  for (final line in card.shows)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(line.label, style: theme.textTheme.labelMedium),
                          Text(line.value),
                        ],
                      ),
                    ),
                  if (card.note case final note?)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(note, style: theme.textTheme.bodySmall),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Semantics(
              container: true,
              liveRegion: _tapped,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(card.statusText),
                  if (card.outcome case final outcome?) Text(outcome),
                ],
              ),
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
            if (card.canDecide) ...[
              const SizedBox(height: 8),
              // Stacked, because side by side they'd have no room on a small phone with large text.
              FilledButton(
                onPressed: busy ? null : () => _tap(() => chat.approve(card), _couldNotApprove),
                child: Text('Approve', semanticsLabel: 'Approve: ${card.title}'),
              ),
              const SizedBox(height: 4),
              OutlinedButton(
                onPressed: busy ? null : () => _tap(() => chat.decline(card), _couldNotReach),
                child: Text('Decline', semanticsLabel: 'Decline: ${card.title}'),
              ),
            ],
            if (card.isRunning) ...[
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: () => _tap(() async {
                  await chat.checkCard(card);
                  return null;
                }, _couldNotReach),
                child: Text('Check again', semanticsLabel: 'Check again: ${card.title}'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
