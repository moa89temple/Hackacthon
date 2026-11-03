import 'dart:async';

import 'package:buddy/spending/spending_backend.dart';

/// Stands in for the backend's spending. Made-up fixtures, only ever in tests.
mixin FakeSpendingCalls implements SpendingBackend {
  SpendingSummary spendingSummary = const SpendingSummary(
    todayNanodollars: 0,
    thisMonthNanodollars: 0,
    backgroundLimitNanodollars: 2000000000,
    backgroundStoppedForToday: false,
  );
  Object? spendingError;

  /// Holding it means the backend hasn't answered yet.
  Completer<void>? holdSpending;

  @override
  Future<SpendingSummary> loadSpending() async {
    if (holdSpending case final hold?) await hold.future;
    if (spendingError case final error?) throw error;
    return spendingSummary;
  }
}
