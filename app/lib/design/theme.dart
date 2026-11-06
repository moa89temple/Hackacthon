import 'package:flutter/material.dart';

/// Every color in the app. The pairs used for text are checked against WCAG AA in test/design_test.dart.
abstract final class BuddyColors {
  /// Temple cherry, for the one thing on a screen that matters most, and for what's selected.
  static const cherry = Color(0xFF9D2235);

  /// Behind a cherry label or icon, such as the selected tab, an icon's square or a Practice mode pill.
  static const cherryTint = Color(0xFFFBEAED);

  /// The Student's own words in the conversation. A shade deeper than the tint, so that they stand apart from Buddy's.
  static const cherryBubble = Color(0xFFF7DDE2);

  /// Going somewhere rather than doing something: a Source, the Guidebook, Organize.
  static const link = Color(0xFF0B5AAD);

  static const ink = Color(0xFF1B1B1F);
  static const inkSoft = Color(0xFF5A5D66);

  /// Behind everything. It's airy and only just off white, so that a white card or a gray frame stands out on it
  /// without a border.
  static const canvas = Color(0xFFFCFCFC);
  static const surface = Colors.white;

  /// A soft gray frame, for a card, a group of rows or Buddy's words.
  static const frame = Color(0xFFF3F3F5);

  /// A gray pill, for a button that isn't the main thing on the screen.
  static const quiet = Color(0xFFEDEDF0);

  static const hairline = Color(0xFFE6E6EA);

  /// The edge of a box to type in, which has to show up for a Student who can't see well.
  static const outline = Color(0xFF8E9099);

  /// Something needs the Student, but nothing has gone wrong.
  static const warningTint = Color(0xFFFDF1E0);
  static const warningInk = Color(0xFF7A4600);

  /// Something went wrong.
  static const problem = Color(0xFFB3261E);
  static const problemTint = Color(0xFFFCEDEB);

  /// Something finished as it should.
  static const good = Color(0xFF17693F);
  static const goodTint = Color(0xFFE6F4EC);
}

/// The sizes that recur. Spacing goes in steps of 4.
abstract final class BuddySizes {
  static const pageEdge = 20.0;
  static const cardRadius = 23.0;
  static const sheetRadius = 26.0;

  /// A box to type in.
  static const controlRadius = 19.0;

  /// Half the height of a button, so that it's a pill.
  static const pillRadius = 24.0;

  /// A short label, such as a state, a count or a day.
  static const chipRadius = 20.0;

  /// A panel inside a card, such as an email's words or a problem.
  static const panelRadius = 16.0;

  /// The tinted square an icon sits in.
  static const iconSquare = 42.0;

  /// A message's corners, and the one corner nearest its speaker, which is tighter.
  static const bubbleRadius = 22.0;
  static const bubbleTail = 7.0;

  /// What floats at the foot of the screen: the box to write in and the tabs.
  static const floatingRadius = 30.0;

  /// Below this a control is hard to hit. Material asks for 48.
  static const tapTarget = 48.0;
}

/// Only what floats has a shadow, and only a soft one, so that nothing needs a heavy border.
abstract final class BuddyShadows {
  static const floating = [BoxShadow(color: Color(0x0D132631), blurRadius: 14, offset: Offset(0, 1))];
}

const _text = TextTheme(
  // The title of a tab.
  displaySmall: TextStyle(fontSize: 26, height: 1.2, fontWeight: FontWeight.w600, letterSpacing: -0.8, color: BuddyColors.ink),
  // The words at the top of Today, which are friendlier than a title.
  headlineLarge: TextStyle(fontSize: 27, height: 1.25, fontWeight: FontWeight.w500, letterSpacing: -0.7, color: BuddyColors.ink),
  // The title of a screen.
  headlineMedium: TextStyle(fontSize: 23, height: 1.25, fontWeight: FontWeight.w600, letterSpacing: -0.7, color: BuddyColors.ink),
  // The title of an Action card.
  headlineSmall: TextStyle(fontSize: 19, height: 1.3, fontWeight: FontWeight.w600, letterSpacing: -0.4, color: BuddyColors.ink),
  // The title of a section.
  titleLarge: TextStyle(fontSize: 18, height: 1.3, fontWeight: FontWeight.w600, letterSpacing: -0.3, color: BuddyColors.ink),
  // The title of a row or a card.
  titleMedium: TextStyle(fontSize: 16, height: 1.35, fontWeight: FontWeight.w600, letterSpacing: -0.25, color: BuddyColors.ink),
  titleSmall: TextStyle(fontSize: 14, height: 1.35, fontWeight: FontWeight.w600, color: BuddyColors.ink),
  // A message in the conversation.
  bodyLarge: TextStyle(fontSize: 16, height: 1.5, fontWeight: FontWeight.w400, color: BuddyColors.ink),
  // Everything else that's read.
  bodyMedium: TextStyle(fontSize: 15, height: 1.53, fontWeight: FontWeight.w400, color: BuddyColors.ink),
  // What supports it, such as a date.
  bodySmall: TextStyle(fontSize: 13, height: 1.45, fontWeight: FontWeight.w400, color: BuddyColors.inkSoft),
  // A button.
  labelLarge: TextStyle(fontSize: 15, height: 1.25, fontWeight: FontWeight.w600),
  // The small capitals above a group, spaced wide so that they read as a label rather than a shout.
  labelMedium: TextStyle(fontSize: 12, height: 1.3, fontWeight: FontWeight.w700, letterSpacing: 1.2, color: BuddyColors.inkSoft),
  labelSmall: TextStyle(fontSize: 12, height: 1.3, fontWeight: FontWeight.w600, color: BuddyColors.inkSoft),
);

/// With the platform's own font, so that a Student gets the system's text wherever they are, in any language.
final _platformText = Typography.material2021().black.merge(_text);

final _pill = RoundedRectangleBorder(borderRadius: BorderRadius.circular(BuddySizes.pillRadius));

/// A gray pill. Inside a gray frame it turns white, so that it still stands out. See [quietButtonOnFrame].
final _quietButton = OutlinedButton.styleFrom(
  foregroundColor: BuddyColors.ink,
  backgroundColor: BuddyColors.quiet,
  disabledForegroundColor: BuddyColors.inkSoft,
  disabledBackgroundColor: BuddyColors.frame,
  minimumSize: const Size(BuddySizes.tapTarget, BuddySizes.tapTarget),
  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
  side: BorderSide.none,
  shape: _pill,
  textStyle: _platformText.labelLarge,
);

/// The same gray pill, made white for the inside of a gray frame or a tinted one. Half white while it can't be tapped.
ButtonStyle quietButtonOnFrame(ThemeData theme) =>
    OutlinedButton.styleFrom(backgroundColor: BuddyColors.surface, disabledBackgroundColor: const Color(0x80FFFFFF)).merge(theme.outlinedButtonTheme.style);

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
    surface: BuddyColors.canvas,
    onSurface: BuddyColors.ink,
    onSurfaceVariant: BuddyColors.inkSoft,
    surfaceContainerLowest: BuddyColors.surface,
    surfaceContainerLow: BuddyColors.frame,
    surfaceContainer: BuddyColors.frame,
    surfaceContainerHigh: BuddyColors.frame,
    surfaceContainerHighest: BuddyColors.quiet,
    outline: BuddyColors.outline,
    outlineVariant: BuddyColors.hairline,
  );

  return ThemeData(
    colorScheme: colors,
    scaffoldBackgroundColor: BuddyColors.canvas,
    canvasColor: BuddyColors.canvas,
    textTheme: _platformText,
    splashFactory: InkRipple.splashFactory,
    appBarTheme: const AppBarTheme(
      backgroundColor: BuddyColors.canvas,
      foregroundColor: BuddyColors.ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: BuddyColors.ink),
    ),
    dividerTheme: const DividerThemeData(color: BuddyColors.hairline, thickness: 1, space: 1),
    cardTheme: CardThemeData(
      color: BuddyColors.frame,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BuddySizes.cardRadius)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: BuddyColors.cherry,
        foregroundColor: Colors.white,
        disabledBackgroundColor: BuddyColors.hairline,
        disabledForegroundColor: BuddyColors.inkSoft,
        minimumSize: const Size(BuddySizes.tapTarget, BuddySizes.tapTarget),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        shape: _pill,
        textStyle: _platformText.labelLarge,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(style: _quietButton),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: BuddyColors.link,
        minimumSize: const Size(BuddySizes.tapTarget, BuddySizes.tapTarget),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        shape: _pill,
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
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
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
      backgroundColor: BuddyColors.quiet,
      selectedColor: BuddyColors.cherryTint,
      secondarySelectedColor: BuddyColors.cherryTint,
      side: BorderSide.none,
      shape: const StadiumBorder(),
      labelStyle: _platformText.titleSmall,
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
      showCheckmark: false,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: BuddyColors.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BuddySizes.sheetRadius)),
      titleTextStyle: _platformText.headlineSmall,
      contentTextStyle: _platformText.bodyMedium,
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: BuddyColors.canvas,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(BuddySizes.sheetRadius))),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: BuddyColors.surface,
      surfaceTintColor: Colors.transparent,
      textStyle: _platformText.bodyMedium,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BuddySizes.panelRadius)),
    ),
    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(color: BuddyColors.ink, borderRadius: BorderRadius.circular(10)),
      textStyle: _platformText.bodySmall?.copyWith(color: Colors.white),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: BuddyColors.ink,
      contentTextStyle: _platformText.bodyMedium?.copyWith(color: Colors.white),
      actionTextColor: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BuddySizes.chipRadius)),
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
