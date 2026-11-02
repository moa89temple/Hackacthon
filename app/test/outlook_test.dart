import 'package:buddy/chat/outlook.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const email = OutlookEmail(to: 'advising@temple.test', subject: 'My hold & my aid', body: 'Hello,\n\nCan you help?');

void main() {
  group('the address for Outlook on the web', () {
    test('opens a new email with the Draft filled in', () {
      final address = outlookWebAddress(email);

      expect(address.scheme, 'https');
      expect(address.host, 'outlook.office.com');
      expect(address.path, '/mail/deeplink/compose');
      expect(address.queryParameters['to'], 'advising@temple.test');
      expect(address.queryParameters['subject'], 'My hold & my aid');
      expect(address.queryParameters['body'], 'Hello,\n\nCan you help?');
    });

    test('writes a space as %20, because Outlook on the web has been reported showing a plus sign for one', () {
      expect(outlookWebAddress(email).toString(), contains('My%20hold%20%26%20my%20aid'));
      expect(outlookWebAddress(email).toString(), isNot(contains('+')));
    });

    test('leaves out who it is to when Buddy has no address', () {
      final address = outlookWebAddress(const OutlookEmail(subject: 'Hi', body: 'Hello'));

      expect(address.queryParameters.containsKey('to'), isFalse);
      expect(address.queryParameters['subject'], 'Hi');
    });

    test('keeps a message that fits, right up to the limit', () {
      final overhead = outlookWebAddress(const OutlookEmail(subject: 'Hi', body: '')).toString().length;
      final fits = 'a' * (mostCharactersInWebAddress - overhead);

      final address = outlookWebAddress(OutlookEmail(subject: 'Hi', body: fits));

      expect(address.toString().length, mostCharactersInWebAddress);
      expect(address.queryParameters['body'], fits);
    });

    test('drops the whole message, rather than cutting it off, when it is too long', () {
      final overhead = outlookWebAddress(const OutlookEmail(subject: 'Hi', body: '')).toString().length;
      final tooLong = 'a' * (mostCharactersInWebAddress - overhead + 1);

      final address = outlookWebAddress(OutlookEmail(to: null, subject: 'Hi', body: tooLong));

      expect(address.queryParameters.containsKey('body'), isFalse);
      expect(address.queryParameters['subject'], 'Hi');
    });

    test('counts the message as it is written in the address, where other languages take more room', () {
      final address = outlookWebAddress(OutlookEmail(subject: 'Hi', body: 'é' * (mostCharactersInWebAddress ~/ 2)));

      expect(address.queryParameters.containsKey('body'), isFalse);
    });

    test('still names who it is to when the subject is too long as well', () {
      final address = outlookWebAddress(OutlookEmail(to: 'a@temple.test', subject: 'b' * 3000, body: 'c' * 3000));

      expect(address.queryParameters, {'to': 'a@temple.test'});
    });
  });

  group('opening it', () {
    test('goes to the Outlook app when the phone has it, and to nothing else', () async {
      final toApp = <OutlookEmail>[];
      final toBrowser = <Uri>[];

      final opened = await openInOutlook(
        email,
        app: (email) async {
          toApp.add(email);
          return true;
        },
        browser: (address) async {
          toBrowser.add(address);
          return true;
        },
      );

      expect(opened, isTrue);
      expect(toApp.single.subject, 'My hold & my aid');
      expect(toBrowser, isEmpty);
    });

    test('goes to Outlook on the web when the phone has no Outlook app', () async {
      final toBrowser = <Uri>[];

      final opened = await openInOutlook(
        email,
        app: (_) async => false,
        browser: (address) async {
          toBrowser.add(address);
          return true;
        },
      );

      expect(opened, isTrue);
      expect(toBrowser.single, outlookWebAddress(email));
    });

    test('goes to Outlook on the web when this phone has no way to ask for the app', () async {
      final opened = await openInOutlook(
        email,
        app: (_) async => throw MissingPluginException(),
        browser: (_) async => true,
      );

      expect(opened, isTrue);
    });

    test('says so when neither would open', () async {
      expect(await openInOutlook(email, app: (_) async => false, browser: (_) async => false), isFalse);
      expect(
        await openInOutlook(email, app: (_) async => false, browser: (_) async => throw PlatformException(code: 'no')),
        isFalse,
      );
    });
  });
}
