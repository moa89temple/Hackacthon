/// What Buddy has spent on Claude, as the backend says. Whole nanodollars, billionths of a dollar, as the backend keeps them.
class SpendingSummary {
  const SpendingSummary({
    required this.todayNanodollars,
    required this.thisMonthNanodollars,
    required this.backgroundLimitNanodollars,
    required this.backgroundStoppedForToday,
  });

  factory SpendingSummary.fromJson(Map<String, dynamic> json) => SpendingSummary(
        todayNanodollars: json['todayNanodollars'] as int,
        thisMonthNanodollars: json['thisMonthNanodollars'] as int,
        backgroundLimitNanodollars: json['backgroundLimitNanodollars'] as int,
        backgroundStoppedForToday: json['backgroundStoppedForToday'] == true,
      );

  final int todayNanodollars;
  final int thisMonthNanodollars;
  final int backgroundLimitNanodollars;
  final bool backgroundStoppedForToday;
}

/// What the app needs from the backend for the You tab's section on spending. It only reads.
abstract interface class SpendingBackend {
  Future<SpendingSummary> loadSpending();
}
