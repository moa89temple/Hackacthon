import 'package:flutter/material.dart';

import 'spending_controller.dart';

const _nanodollarsPerCent = 10000000;
const _lessThanACent = 'less than 1 cent';

/// To the nearest cent.
int _cents(int nanodollars) => (nanodollars + _nanodollarsPerCent ~/ 2) ~/ _nanodollarsPerCent;

/// Whether this is some money, but too little to round up to a cent. "\$0.00" would say Buddy spent nothing.
bool _isUnderACent(int nanodollars) => nanodollars > 0 && _cents(nanodollars) == 0;

/// Such as "\$1.50".
String moneyOnScreen(int nanodollars) {
  if (_isUnderACent(nanodollars)) return _lessThanACent;
  final cents = _cents(nanodollars);
  return '\$${cents ~/ 100}.${(cents % 100).toString().padLeft(2, '0')}';
}

/// Such as "1 dollar and 50 cents". A screen reader can make a mess of "\$1.50".
String moneyAloud(int nanodollars) {
  if (_isUnderACent(nanodollars)) return _lessThanACent;
  final total = _cents(nanodollars);
  if (total == 0) return '0 dollars';
  final dollars = total ~/ 100;
  final cents = total % 100;
  return [
    if (dollars > 0) '$dollars ${dollars == 1 ? 'dollar' : 'dollars'}',
    if (cents > 0) '$cents ${cents == 1 ? 'cent' : 'cents'}',
  ].join(' and ');
}

/// The You tab's section on what Buddy has spent on Claude. The backend does all the adding up.
class SpendingSection extends StatelessWidget {
  const SpendingSection({super.key, required this.spending});

  final SpendingController spending;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: spending,
      builder: (context, _) {
        final summary = spending.summary;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              child: Text('What Buddy spent', style: theme.textTheme.titleMedium),
            ),
            const SizedBox(height: 8),
            if (spending.couldNotLoad) ...[
              Semantics(
                liveRegion: true,
                child: const Text("The app can't reach Buddy right now. Check that the backend is running."),
              ),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton(onPressed: spending.load, child: const Text('Try again', semanticsLabel: 'Try loading what Buddy spent again')),
              ),
            ] else if (summary == null)
              const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading what Buddy spent'))
            else ...[
              // Each its own stop for a screen reader, because on Android their lines otherwise run together.
              Semantics(
                container: true,
                child: Text(
                  'Today: ${moneyOnScreen(summary.todayNanodollars)}',
                  semanticsLabel: 'Today: ${moneyAloud(summary.todayNanodollars)}',
                ),
              ),
              Semantics(
                container: true,
                child: Text(
                  'This month: ${moneyOnScreen(summary.thisMonthNanodollars)}',
                  semanticsLabel: 'This month: ${moneyAloud(summary.thisMonthNanodollars)}',
                ),
              ),
              const SizedBox(height: 8),
              const Text("This is what Claude cost, for chat, Tasks and background work together. A day and a month go by Philadelphia's clock."),
              const SizedBox(height: 8),
              if (summary.backgroundStoppedForToday)
                Semantics(
                  container: true,
                  liveRegion: true,
                  child: Text(
                    'Background work has stopped for today, because it reached its limit of ${moneyOnScreen(summary.backgroundLimitNanodollars)}. '
                    'It resumes tomorrow. Chat, Tasks and Briefings keep working.',
                    semanticsLabel: 'Background work has stopped for today, because it reached its limit of ${moneyAloud(summary.backgroundLimitNanodollars)}. '
                        'It resumes tomorrow. Chat, Tasks and Briefings keep working.',
                  ),
                )
              else
                Semantics(
                  container: true,
                  child: Text(
                    'Background work stops for the day if it reaches ${moneyOnScreen(summary.backgroundLimitNanodollars)}. Chat has no limit.',
                    semanticsLabel: 'Background work stops for the day if it reaches ${moneyAloud(summary.backgroundLimitNanodollars)}. Chat has no limit.',
                  ),
                ),
            ],
          ],
        );
      },
    );
  }
}
