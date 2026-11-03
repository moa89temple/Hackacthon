import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../sending/sending_section.dart';
import 'chat_controller.dart';
import 'crisis_card.dart';

const _couldNotApprove =
    "The app couldn't reach Buddy, so it may or may not have started. It's safe to tap Approve again: Buddy won't do it twice.";
const _couldNotReach = "The app couldn't reach Buddy. Check that the backend is running, then try again.";
const _couldNotSwitch = "The app couldn't reach Buddy, so it may or may not have switched. Check on the You tab, then try again.";
const _needSomeoneNow = "Need someone right now? You don't have to wait for this email.";
const _couldNotCall = "Your phone couldn't open that. Dial 988 yourself, or use another phone if you can.";

/// Shows exactly what will happen, and asks for the Student's tap. What it says will happen comes from the
/// backend's own record of the card, never from what Claude wrote in the chat, and Approve is the only
/// thing in the app that can give an Action Permission. An email from the Crisis card also keeps 988 next
/// to it, in the app's own words.
class ActionCardView extends StatefulWidget {
  const ActionCardView({super.key, required this.card, required this.chat, required this.openPhone, required this.announce});

  final ActionCard card;
  final ChatController chat;
  final PhoneOpener openPhone;

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

  /// Asks first, as the You tab does. Live is the Student's to choose, and it makes a new card for them to approve.
  Future<void> _switchToLive() async {
    final card = widget.card;
    final yes = await askToSwitchToLive(
      context,
      goesTo: "whoever it's written to, including the person you chose",
      cardsStopping: 'Every card waiting for a tap stops working, Buddy makes a new one of this email for you to approve',
    );
    if (yes) await _tap(() => widget.chat.switchCardToLive(card), _couldNotSwitch);
  }

  /// The Crisis card may have scrolled out of view by now, and this must never stand between the Student and help.
  Future<void> _call988() async {
    bool opened;
    try {
      opened = await widget.openPhone(Uri.parse('tel:988'));
    } on Exception {
      opened = false;
    }
    if (mounted) setState(() => _problem = opened ? null : _couldNotCall);
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
              if (card.offersLive) ...[
                const SizedBox(height: 4),
                OutlinedButton(
                  onPressed: busy ? null : _switchToLive,
                  child: Text('Switch to Live', semanticsLabel: 'Switch to Live: ${card.title}'),
                ),
              ],
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
            if (card.isCrisisEmail) ...[
              const SizedBox(height: 12),
              Semantics(container: true, child: Text(_needSomeoneNow, style: theme.textTheme.bodySmall)),
              const SizedBox(height: 4),
              FilledButton.icon(icon: const Icon(Icons.call), label: const Text('Call 988'), onPressed: _call988),
            ],
          ],
        ),
      ),
    );
  }
}
