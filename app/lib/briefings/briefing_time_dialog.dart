import 'package:flutter/material.dart';

/// Asks for a time of day. Flutter's own time picker runs off a small phone's screen with large text, so
/// this is three plain lists in a dialog that scrolls. Returns HH:MM, or null if the Student cancels.
Future<String?> askForBriefingTime(BuildContext context, {required String title, required String current}) {
  return showDialog<String>(
    context: context,
    builder: (context) => _BriefingTimeDialog(title: title, current: current),
  );
}

class _BriefingTimeDialog extends StatefulWidget {
  const _BriefingTimeDialog({required this.title, required this.current});

  final String title;
  final String current;

  @override
  State<_BriefingTimeDialog> createState() => _BriefingTimeDialogState();
}

class _BriefingTimeDialogState extends State<_BriefingTimeDialog> {
  late int _hour;
  late int _minute;
  late bool _afternoon;

  @override
  void initState() {
    super.initState();
    final [hour, minute] = widget.current.split(':').map(int.parse).toList();
    _afternoon = hour >= 12;
    _hour = hour % 12 == 0 ? 12 : hour % 12;
    _minute = minute;
  }

  String get _chosen {
    final hour = (_hour % 12) + (_afternoon ? 12 : 0);
    return '${hour.toString().padLeft(2, '0')}:${_minute.toString().padLeft(2, '0')}';
  }

  Widget _list<T>({required String label, required T value, required Map<T, String> choices, required ValueChanged<T> onChanged}) {
    return DropdownButtonFormField<T>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [
        for (final MapEntry(key: choice, value: words) in choices.entries) DropdownMenuItem(value: choice, child: Text(words)),
      ],
      onChanged: (chosen) {
        if (chosen != null) onChanged(chosen);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      scrollable: true,
      title: Text(widget.title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _list(
            label: 'Hour',
            value: _hour,
            choices: {for (var hour = 1; hour <= 12; hour++) hour: '$hour'},
            onChanged: (hour) => setState(() => _hour = hour),
          ),
          const SizedBox(height: 8),
          _list(
            label: 'Minute',
            value: _minute,
            choices: {for (var minute = 0; minute < 60; minute++) minute: minute.toString().padLeft(2, '0')},
            onChanged: (minute) => setState(() => _minute = minute),
          ),
          const SizedBox(height: 8),
          _list(
            label: 'Morning or afternoon',
            value: _afternoon,
            choices: const {false: 'AM', true: 'PM'},
            onChanged: (afternoon) => setState(() => _afternoon = afternoon),
          ),
          const SizedBox(height: 8),
          const Text('Philadelphia time.'),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.of(context).pop(_chosen), child: const Text('Save')),
      ],
    );
  }
}
