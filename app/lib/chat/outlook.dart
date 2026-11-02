import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

/// A new email for the Student to look over and send themselves.
class OutlookEmail {
  const OutlookEmail({this.to, required this.subject, required this.body});

  /// Null when Buddy has no address for the Contact, and the Student adds one.
  final String? to;
  final String subject;
  final String body;
}

/// Opens the email outside Buddy, in the Student's own app or browser. Returns false if it couldn't.
typedef DraftOpener = Future<bool> Function(OutlookEmail email);

/// Microsoft publishes no limit for this address. It also goes through the sign-in pages when the
/// browser isn't signed in, which make it longer, so this stays well under the limits they could have.
const mostCharactersInWebAddress = 2000;

const _webCompose = 'https://outlook.office.com/mail/deeplink/compose';

/// Outlook on the web's address for a new email, for a TUmail account signed in to the phone's browser.
/// Nothing is ever cut off: what doesn't fit is left out whole, and the Student pastes it in.
Uri outlookWebAddress(OutlookEmail email) {
  String address(List<(String, String)> fields) {
    final query = [for (final (name, value) in fields) '$name=${Uri.encodeComponent(value)}'].join('&');
    return query.isEmpty ? _webCompose : '$_webCompose?$query';
  }

  final to = [if (email.to case final to?) ('to', to)];
  final subject = ('subject', email.subject);
  final body = ('body', email.body);
  final withEverything = address([...to, subject, body]);
  if (withEverything.length <= mostCharactersInWebAddress) return Uri.parse(withEverything);
  final withoutBody = address([...to, subject]);
  if (withoutBody.length <= mostCharactersInWebAddress) return Uri.parse(withoutBody);
  return Uri.parse(address(to));
}

/// The Outlook app first, because that's how Temple tells Students to read TUmail on Android and it
/// can't end up in another mail account's app. Outlook on the web is next, for a phone without it.
Future<bool> openInOutlook(
  OutlookEmail email, {
  required DraftOpener app,
  required Future<bool> Function(Uri address) browser,
}) async {
  try {
    if (await app(email)) return true;
  } on Exception {
    // A phone that can't ask for the app, such as an iPhone for now, still has its browser.
  }
  try {
    return await browser(outlookWebAddress(email));
  } on Exception {
    return false;
  }
}

const _outlookApp = MethodChannel('buddy/outlook');

/// Handled in MainActivity.kt.
Future<bool> _openOutlookApp(OutlookEmail email) async =>
    await _outlookApp.invokeMethod<bool>('compose', {'to': email.to, 'subject': email.subject, 'body': email.body}) ??
    false;

/// Never in a view inside Buddy, so that Buddy can't see what happens next.
Future<bool> _openInOwnBrowser(Uri address) => launchUrl(address, mode: LaunchMode.externalApplication);

Future<bool> openDraftInOutlook(OutlookEmail email) =>
    openInOutlook(email, app: _openOutlookApp, browser: _openInOwnBrowser);
