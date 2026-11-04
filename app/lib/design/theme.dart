import 'package:flutter/material.dart';

/// Every color in the app. The pairs used for text are checked against WCAG AA in test/design_test.dart.
abstract final class BuddyColors {
  /// Temple cherry, for the one thing on a screen that matters most, and for what's selected.
  static const cherry = Color(0xFF9D2235);

  /// Behind a cherry label or icon, such as the selected tab or a Practice mode pill.
  static const cherryTint = Color(0xFFFBEAED);

  /// Going somewhere rather than doing something: a Source, the Guidebook, Organize.
  static const link = Color(0xFF0B5AAD);

  static const ink = Color(0xFF1B1B1F);
  static const inkSoft = Color(0xFF5A5D66);
  static const hairline = Color(0xFFE1E1E6);
  static const outline = Color(0xFF8E9099);
  static const surface = Colors.white;
  static const surfaceQuiet = Color(0xFFF5F5F7);

  /// Something needs the Student, but nothing has gone wrong.
  static const warningTint = Color(0xFFFDF1E0);
  static const warningInk = Color(0xFF7A4600);
  static const warningBorder = Color(0xFFF2D6AE);

  /// Something went wrong.
  static const problem = Color(0xFFB3261E);
  static const problemTint = Color(0xFFFCEDEB);

  /// Something finished as it should.
  static const good = Color(0xFF17693F);
}

/// The sizes that recur. Spacing goes in steps of 4.
abstract final class BuddySizes {
  static const pageEdge = 20.0;
  static const cardRadius = 16.0;
  static const controlRadius = 12.0;

  /// Below this a control is hard to hit. Material asks for 48.
  static const tapTarget = 48.0;
}

const _text = TextTheme(
  // The title of a tab.
  displaySmall: TextStyle(fontSize: 32, height: 1.15, fontWeight: FontWeight.w800, letterSpacing: -0.6, color: BuddyColors.ink),
  // The title of a screen.
  headlineMedium: TextStyle(fontSize: 28, height: 1.18, fontWeight: FontWeight.w800, letterSpacing: -0.5, color: BuddyColors.ink),
  // The title of an Action card.
  headlineSmall: TextStyle(fontSize: 24, height: 1.2, fontWeight: FontWeight.w800, letterSpacing: -0.3, color: BuddyColors.ink),
  // The title of a section.
  titleLarge: TextStyle(fontSize: 20, height: 1.25, fontWeight: FontWeight.w800, letterSpacing: -0.2, color: BuddyColors.ink),
  // The title of a row or a card.
  titleMedium: TextStyle(fontSize: 16, height: 1.3, fontWeight: FontWeight.w700, color: BuddyColors.ink),
  titleSmall: TextStyle(fontSize: 14, height: 1.3, fontWeight: FontWeight.w700, color: BuddyColors.ink),
  // A message in the conversation.
  bodyLarge: TextStyle(fontSize: 16, height: 1.45, fontWeight: FontWeight.w400, color: BuddyColors.ink),
  // Everything else that's read.
  bodyMedium: TextStyle(fontSize: 15, height: 1.4, fontWeight: FontWeight.w400, color: BuddyColors.ink),
  // What supports it, such as a date.
  bodySmall: TextStyle(fontSize: 13, height: 1.35, fontWeight: FontWeight.w400, color: BuddyColors.inkSoft),
  // A button.
  labelLarge: TextStyle(fontSize: 15, height: 1.25, fontWeight: FontWeight.w700),
  // The small capitals above a group.
  labelMedium: TextStyle(fontSize: 12, height: 1.3, fontWeight: FontWeight.w700, letterSpacing: 0.6, color: BuddyColors.inkSoft),
  labelSmall: TextStyle(fontSize: 12, height: 1.3, fontWeight: FontWeight.w600, color: BuddyColors.inkSoft),
);

/// With the platform's own font, so that a Student gets the system's text wherever they are, in any language.
final _platformText = Typography.material2021().black.merge(_text);

final _controlShape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(BuddySizes.controlRadius));

/// Buttons take their height from here, so that every one is easy to hit whatever screen it's on.
ThemeData buddyTheme() {
  const colors = ColorScheme(
    brightness: Brightness.light,
    primary: BuddyColors.cherry,
    onPrimary: Colors.white,
    primaryContainer: BuddyColors.cherryTint,
    onPrimaryContainer: BuddyColors.cherry,
    secondary: BuddyColors.link,
    onSecondary: Colors.white,
    tertiary: BuddyColors.warningInk,
    onTertiary: Colors.white,
    error: BuddyColors.problem,
    onError: Colors.white,
    errorContainer: BuddyColors.problemTint,
    onErrorContainer: BuddyColors.problem,
    surface: BuddyColors.surface,
    onSurface: BuddyColors.ink,
    onSurfaceVariant: BuddyColors.inkSoft,
    surfaceContainerLowest: BuddyColors.surface,
    surfaceContainerLow: BuddyColors.surfaceQuiet,
    surfaceContainer: BuddyColors.surfaceQuiet,
    surfaceContainerHigh: BuddyColors.surfaceQuiet,
    surfaceContainerHighest: BuddyColors.surfaceQuiet,
    outline: BuddyColors.outline,
    outlineVariant: BuddyColors.hairline,
  );

  return ThemeData(
    colorScheme: colors,
    scaffoldBackgroundColor: BuddyColors.surface,
    textTheme: _platformText,
    splashFactory: InkRipple.splashFactory,
    appBarTheme: const AppBarTheme(
      backgroundColor: BuddyColors.surface,
      foregroundColor: BuddyColors.ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: BuddyColors.ink),
    ),
    dividerTheme: const DividerThemeData(color: BuddyColors.hairline, thickness: 1, space: 1),
    cardTheme: CardThemeData(
      color: BuddyColors.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BuddySizes.cardRadius),
        side: const BorderSide(color: BuddyColors.hairline),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: BuddyColors.cherry,
        foregroundColor: Colors.white,
        disabledBackgroundColor: BuddyColors.hairline,
        disabledForegroundColor: BuddyColors.inkSoft,
        minimumSize: const Size(BuddySizes.tapTarget, 52),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        shape: _controlShape,
        textStyle: _platformText.labelLarge,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: BuddyColors.ink,
        minimumSize: const Size(BuddySizes.tapTarget, 52),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        side: const BorderSide(color: BuddyColors.outline),
        shape: _controlShape,
        textStyle: _platformText.labelLarge,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: BuddyColors.link,
        minimumSize: const Size(BuddySizes.tapTarget, BuddySizes.tapTarget),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        shape: _controlShape,
        textStyle: _platformText.labelLarge,
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        foregroundColor: BuddyColors.ink,
        minimumSize: const Size(BuddySizes.tapTarget, BuddySizes.tapTarget),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: BuddyColors.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BuddySizes.controlRadius),
        borderSide: const BorderSide(color: BuddyColors.outline),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BuddySizes.controlRadius),
        borderSide: const BorderSide(color: BuddyColors.outline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BuddySizes.controlRadius),
        borderSide: const BorderSide(color: BuddyColors.cherry, width: 2),
      ),
      labelStyle: const TextStyle(color: BuddyColors.inkSoft),
      floatingLabelStyle: const TextStyle(color: BuddyColors.cherry),
      hintStyle: const TextStyle(color: BuddyColors.inkSoft),
    ),
    checkboxTheme: CheckboxThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      side: const BorderSide(color: BuddyColors.outline, width: 1.5),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: BuddyColors.surface,
      selectedColor: BuddyColors.cherryTint,
      secondarySelectedColor: BuddyColors.cherryTint,
      side: const BorderSide(color: BuddyColors.hairline),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      labelStyle: _platformText.titleSmall,
      showCheckmark: false,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: BuddyColors.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      titleTextStyle: _platformText.titleLarge,
      contentTextStyle: _platformText.bodyMedium,
    ),
    bottomSheetTheme: const BottomSheetThemeData(backgroundColor: BuddyColors.surface, surfaceTintColor: Colors.transparent),
    popupMenuTheme: PopupMenuThemeData(
      color: BuddyColors.surface,
      surfaceTintColor: Colors.transparent,
      textStyle: _platformText.bodyMedium,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BuddySizes.controlRadius)),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: BuddyColors.ink,
      contentTextStyle: _platformText.bodyMedium?.copyWith(color: Colors.white),
      actionTextColor: Colors.white,
      shape: _controlShape,
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: BuddyColors.cherry, linearTrackColor: BuddyColors.cherryTint),
  );
}

/// The date on Philadelphia's clock, which is the one everything in Buddy goes by, wherever the phone is.
/// Eastern time changes on the second Sunday of March and the first Sunday of November, both at 2 a.m.
DateTime philadelphiaNow(DateTime moment) {
  final utc = moment.toUtc();
  DateTime sundayOf(int month, {required int week}) {
    final first = DateTime.utc(utc.year, month);
    final firstSunday = 1 + (7 - first.weekday) % 7;
    return DateTime.utc(utc.year, month, firstSunday + 7 * (week - 1));
  }

  // 2 a.m. Eastern Standard is 7 a.m. UTC, and 2 a.m. Eastern Daylight is 6 a.m. UTC.
  final summerStarts = sundayOf(3, week: 2).add(const Duration(hours: 7));
  final summerEnds = sundayOf(11, week: 1).add(const Duration(hours: 6));
  final isSummer = !utc.isBefore(summerStarts) && utc.isBefore(summerEnds);
  return utc.subtract(Duration(hours: isSummer ? 4 : 5));
}
