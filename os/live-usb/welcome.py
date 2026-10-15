#!/usr/bin/python3
"""Trusted native USB entry; no browser messages, shell strings or drive arguments."""
import os
from pathlib import Path
import subprocess
import sys

NODE = '/opt/kidos-node/v24.21.0/bin/node'
KIOSK = '/opt/kidos/current/os/linux-pc/kiosk.mjs'
INSTALLER = '/usr/bin/calamares-install-debian'


def live_trial(cmdline=None, medium=None):
    if cmdline is None:
        cmdline = Path('/proc/cmdline').read_text()
    if medium is None:
        medium = Path('/run/live/medium').is_dir()
    return 'boot=live' in cmdline.split() and medium


def launch_command(action, live):
    if action == 'try':
        return [NODE, KIOSK, '--launch']
    if action == 'install' and live:
        return [INSTALLER]
    raise ValueError('Unavailable action')


def main(args):
    if args not in ([], ['--startup']):
        raise ValueError('Open the USB entry without arguments.')
    if sys.platform != 'linux' or os.getuid() < 1000:
        raise ValueError('Use the ordinary Linux desktop account.')
    import gi
    gi.require_version('Gtk', '3.0')
    from gi.repository import Gtk
    live = live_trial()
    if not live and args == ['--startup']:
        subprocess.Popen(launch_command('try', live), close_fds=True)
        return
    dialog = Gtk.Dialog(title='Try kidOS' if live else 'kidOS')
    dialog.set_default_size(460, 180)
    dialog.set_border_width(16)
    dialog.add_button('Close', Gtk.ResponseType.CANCEL)
    if live:
        dialog.add_button('Install kidOS…', 2)
    dialog.add_button('Try kidOS' if live else 'Open kidOS', 1)
    dialog.set_default_response(1)
    text = ('Try kidOS from this USB without installing onto your computer.\n\n'
            'Files you create in this trial disappear when you shut down. '
            'Export anything you want to keep.\n\n'
            'Installation is optional and opens a separate drive-selection installer.'
            if live else 'Open your local kidOS computer.')
    label = Gtk.Label(label=text)
    label.set_line_wrap(True)
    label.set_max_width_chars(56)
    label.set_xalign(0)
    dialog.get_content_area().pack_start(label, True, True, 8)
    dialog.show_all()
    response = dialog.run()
    dialog.destroy()
    if response == 1:
        subprocess.Popen(launch_command('try', live), close_fds=True)
    elif response == 2 and live:
        confirm = Gtk.MessageDialog(message_type=Gtk.MessageType.WARNING,
                                   buttons=Gtk.ButtonsType.NONE,
                                   text='Open the kidOS installer?')
        confirm.format_secondary_text('Installing onto a drive can erase its existing files. '
            'Back up first. Review the chosen drive and every planned change in the '
            'installer before its final Install confirmation. Closing it keeps you in the USB trial.')
        confirm.add_button('Keep trying', Gtk.ResponseType.CANCEL)
        confirm.add_button('Open installer', Gtk.ResponseType.OK)
        confirm.set_default_response(Gtk.ResponseType.CANCEL)
        answer = confirm.run()
        confirm.destroy()
        if answer == Gtk.ResponseType.OK:
            subprocess.Popen(launch_command('install', live), close_fds=True)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print('kidOS USB: ' + str(error), file=sys.stderr)
        sys.exit(1)
