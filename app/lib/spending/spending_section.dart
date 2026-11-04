import 'package:flutter/material.dart';

import '../design/parts.dart';
import '../design/theme.dart';
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

/// What Buddy has spent on Claude. The backend does all the adding up.
class SpendingScreen extends StatelessWidget {
  const SpendingScreen({super.key, required this.spending});

  final SpendingController spending;

  Widget _amount(BuildContext context, String period, int nanodollars) {
    final text = Theme.of(context).textTheme;
    // Each its own stop for a screen reader, because on Android their lines otherwise run together.
    return Semantics(
      container: true,
      label: '$period: ${moneyAloud(nanodollars)}',
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Wrap(
          alignment: WrapAlignment.spaceBetween,
          spacing: 12,
          children: [
            Text(period, style: text.titleMedium),
            Text('$period: ${moneyOnScreen(nanodollars)}'.substring(period.length + 2), style: text.titleLarge),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: spending,
      builder: (context, _) {
        final summary = spending.summary;
        return SubScreen(
          title: 'What Buddy spent',
          subtitle: "This is what Claude cost, for chat, Tasks and background work together. A day and a month go by Philadelphia's clock.",
          children: [
            if (spending.couldNotLoad)
              EmptyState(
                icon: Icons.layers_outlined,
                isProblem: true,
                words: "The app can't reach Buddy right now. Check that the backend is running.",
                action: AppLink('Try again', semanticsLabel: 'Try loading what Buddy spent again', onPressed: spending.load),
              )
            else if (summary == null)
              const LoadingBlock(label: 'Loading what Buddy spent')
            else ...[
              RowGroup(
                children: [
                  _amount(context, 'Today', summary.todayNanodollars),
                  _amount(context, 'This month', summary.thisMonthNanodollars),
                ],
              ),
              const SizedBox(height: 16),
              if (summary.backgroundStoppedForToday)
                Semantics(
                  container: true,
                  liveRegion: true,
                  label: 'Background work has stopped for today, because it reached its limit of ${moneyAloud(summary.backgroundLimitNanodollars)}. '
                      'It resumes tomorrow. Chat, Tasks and Briefings keep working.',
                  excludeSemantics: true,
                  child: NoticeCard(
                    words: 'Background work has stopped for today, because it reached its limit of ${moneyOnScreen(summary.backgroundLimitNanodollars)}. '
                        'It resumes tomorrow. Chat, Tasks and Briefings keep working.',
                  ),
                )
              else
                Semantics(
                  container: true,
                  child: Text(
                    'Background work stops for the day if it reaches ${moneyOnScreen(summary.backgroundLimitNanodollars)}. Chat has no limit.',
                    semanticsLabel: 'Background work stops for the day if it reaches ${moneyAloud(summary.backgroundLimitNanodollars)}. Chat has no limit.',
                    style: const TextStyle(color: BuddyColors.inkSoft),
                  ),
                ),
            ],
          ],
        );
      },
    );
  }
}
