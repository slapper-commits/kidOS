#!/usr/bin/python3.13
"""Native kidOS chooser for the fixed Debian Simon Tatham puzzle collection.

The catalog is a protected release asset, not a user-editable launch recipe.
Importing this module for tests never imports GTK or opens a display.
"""
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys


class PuzzleError(Exception):
    pass


def validate_catalog(value):
    if not isinstance(value, dict) or set(value) != {"format", "starters", "puzzles"} or type(value["format"]) is not int or value["format"] != 1:
        raise PuzzleError("The puzzle collection needs to be reinstalled.")
    entries = value["puzzles"]
    if not isinstance(entries, list) or len(entries) != 40:
        raise PuzzleError("The puzzle collection needs to be reinstalled.")
    result = {}
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"id", "name", "description", "binary"}:
            raise PuzzleError("The puzzle collection needs to be reinstalled.")
        identity = entry["id"]
        if (not isinstance(identity, str) or not re.fullmatch(r"[a-z]{2,12}", identity)
                or identity in result or entry["binary"] != "/usr/games/sgt-" + identity
                or any(not isinstance(entry[key], str) or not 1 <= len(entry[key]) <= limit
                       for key, limit in [("name", 40), ("description", 100)])):
            raise PuzzleError("The puzzle collection needs to be reinstalled.")
        result[identity] = dict(entry)
    starters = value["starters"]
    if (not isinstance(starters, list) or len(starters) != 6
            or any(not isinstance(item, str) or item not in result for item in starters)
            or len(set(starters)) != 6):
        raise PuzzleError("The puzzle collection needs to be reinstalled.")
    return result, tuple(starters)


def matching_ids(catalog, query):
    query = query.strip().casefold()
    return tuple(identity for identity in sorted(catalog, key=lambda item: catalog[item]["name"].casefold())
                 if query in (catalog[identity]["name"] + " " + catalog[identity]["description"]).casefold())


def protected_binary(path, inspect=os.lstat):
    """Do not follow executable links or use a writable game directory."""
    try:
        for parent in Path(path).parents:
            info = inspect(str(parent))
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                return False
        info = inspect(path)
        return (stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                and not info.st_mode & 0o022 and bool(info.st_mode & 0o111))
    except OSError:
        return False


def command_for(identity, catalog, check=protected_binary):
    if not isinstance(identity, str) or identity not in catalog:
        raise PuzzleError("Choose a puzzle from this collection.")
    binary = catalog[identity]["binary"]
    if not check(binary):
        raise PuzzleError("This puzzle is not installed or ready on this computer.")
    return [binary]


def game_environment(inherited):
    # Inherit ordinary user save locations, never executable/module overrides.
    names = ("HOME", "USER", "LOGNAME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME",
             "XDG_RUNTIME_DIR", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS")
    return {**{key: inherited[key] for key in names if key in inherited},
            "PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "GDK_BACKEND": "wayland"}


def launch_puzzle(identity, catalog, inherited, *, check=protected_binary, spawn=subprocess.Popen):
    command = command_for(identity, catalog, check)
    try:
        return spawn(command, shell=False, env=game_environment(inherited),
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError as error:
        raise PuzzleError("The puzzle could not open. Try again after checking its installation.") from error


STYLE = b"""
window { background: #f3edcf; color: #202e2d; font: 14px Sans; }
.puzzle-header { background: #233c65; color: #fffef5; padding: 16px 20px; }
.puzzle-title { font-size: 24px; font-weight: bold; }
.puzzle-subtitle { color: #e1e6d8; }
notebook { background: #f3edcf; }
notebook header { background: #d8d8cd; }
notebook tab { padding: 10px 16px; }
notebook tab:checked { background: #f3edcf; color: #233c65; }
button { background: #fffef5; color: #202e2d; border: 1px solid #77877e;
         border-radius: 4px; box-shadow: none; text-shadow: none; padding: 10px; }
button:hover { background: #e3ecd9; border-color: #23776f; }
button:active { background: #d5e8db; }
button:focus { outline: 3px solid #23776f; outline-offset: -4px; }
button:disabled { background: #d8d8cd; color: #626962; }
.puzzle-name { color: #233c65; font-weight: bold; font-size: 17px; }
.puzzle-description { font-size: 13px; }
.puzzle-card { padding: 16px; }
entry { background: #fffef5; color: #202e2d; border: 1px solid #77877e;
        border-radius: 4px; padding: 8px; }
entry:focus { border: 2px solid #23776f; }
list, viewport { background: #f3edcf; }
row { padding: 3px 0; }
.puzzle-footer { padding: 10px 16px; background: #d8d8cd; font-size: 12px; }
"""


def run_chooser(catalog, starters):
    import gi
    gi.require_version("Gtk", "3.0")
    from gi.repository import Gdk, Gio, GLib, Gtk, Pango

    def label(text, style=None, width=None):
        item = Gtk.Label(label=text, xalign=0)
        item.set_line_wrap(True)
        item.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR)
        if width:
            item.set_max_width_chars(width)
        if style:
            item.get_style_context().add_class(style)
        return item

    def scroller(content):
        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        scroll.add(content)
        return scroll

    class PuzzleBox(Gtk.Application):
        def __init__(self):
            super().__init__(application_id="org.kidos.PuzzleBox", flags=Gio.ApplicationFlags.FLAGS_NONE)
            self.window = None
            self.pending = set()

        def do_activate(self):
            if self.window is not None:
                self.window.present()
                return
            provider = Gtk.CssProvider()
            provider.load_from_data(STYLE)
            Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
            window = Gtk.ApplicationWindow(application=self, title="Puzzle Box")
            self.window = window
            window.set_default_size(720, 560)
            window.set_size_request(420, 340)
            window.connect("destroy", lambda *_: setattr(self, "window", None))
            body = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
            window.add(body)
            header = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
            header.get_style_context().add_class("puzzle-header")
            header.pack_start(label("Puzzle Box", "puzzle-title"), False, False, 0)
            header.pack_start(label("Pick a puzzle. Take your time.", "puzzle-subtitle"), False, False, 0)
            body.pack_start(header, False, False, 0)
            self.notebook = Gtk.Notebook()
            body.pack_start(self.notebook, True, True, 0)
            start = Gtk.FlowBox()
            start.set_border_width(12)
            start.set_selection_mode(Gtk.SelectionMode.NONE)
            start.set_homogeneous(True)
            start.set_min_children_per_line(1)
            start.set_max_children_per_line(2)
            start.set_column_spacing(10)
            start.set_row_spacing(10)
            for identity in starters:
                start.add(self.puzzle_button(identity, card=True))
            self.notebook.append_page(scroller(start), Gtk.Label(label="Start here"))
            all_page = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
            all_page.set_border_width(12)
            self.search = Gtk.SearchEntry(placeholder_text="Find a puzzle")
            self.search.get_accessible().set_name("Find a puzzle")
            all_page.pack_start(self.search, False, False, 0)
            self.count = label("40 puzzles")
            all_page.pack_start(self.count, False, False, 0)
            self.visible_ids = set(catalog)
            self.results = Gtk.ListBox()
            self.results.set_selection_mode(Gtk.SelectionMode.NONE)
            for identity in sorted(catalog, key=lambda item: catalog[item]["name"].casefold()):
                row = Gtk.ListBoxRow()
                row.identity = identity
                row.add(self.puzzle_button(identity))
                self.results.add(row)
            self.results.set_filter_func(self.match_puzzle)
            self.search.connect("search-changed", self.filter_puzzles)
            all_page.pack_start(scroller(self.results), True, True, 0)
            self.notebook.append_page(all_page, Gtk.Label(label="All 40 puzzles"))
            footer = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
            footer.get_style_context().add_class("puzzle-footer")
            self.status = label("Simon Tatham’s Portable Puzzle Collection", width=55)
            footer.pack_start(self.status, True, True, 0)
            help_button = Gtk.Button.new_with_mnemonic("_Help")
            help_button.connect("clicked", self.help)
            footer.pack_end(help_button, False, False, 0)
            body.pack_end(footer, False, False, 0)
            for name, accelerator, callback in [("close", "<Primary>w", lambda *_: window.close()),
                                                 ("find", "<Primary>f", self.find)]:
                action = Gio.SimpleAction.new(name, None)
                action.connect("activate", callback)
                window.add_action(action)
                self.set_accels_for_action("win." + name, [accelerator])
            window.show_all()

        def puzzle_button(self, identity, card=False):
            puzzle = catalog[identity]
            button = Gtk.Button()
            content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
            content.pack_start(label(puzzle["name"], "puzzle-name"), False, False, 0)
            content.pack_start(label(puzzle["description"], "puzzle-description", 28 if card else 70), False, False, 0)
            button.add(content)
            if card:
                button.get_style_context().add_class("puzzle-card")
            button.get_accessible().set_name(puzzle["name"] + ". " + puzzle["description"])
            if not protected_binary(puzzle["binary"]):
                button.set_sensitive(False)
                button.set_tooltip_text("Not installed or ready on this computer.")
            button.connect("clicked", self.open_puzzle, identity)
            return button

        def match_puzzle(self, row):
            return row.identity in self.visible_ids

        def filter_puzzles(self, *_):
            self.visible_ids = set(matching_ids(catalog, self.search.get_text()))
            count = len(self.visible_ids)
            self.count.set_text("No puzzles found. Try a different word." if count == 0 else str(count) + (" puzzle" if count == 1 else " puzzles"))
            self.results.invalidate_filter()

        def find(self, *_):
            self.notebook.set_current_page(1)
            self.search.grab_focus()

        def open_puzzle(self, button, identity):
            if identity in self.pending:
                return
            try:
                child = launch_puzzle(identity, catalog, os.environ)
            except PuzzleError as error:
                self.status.set_text(str(error))
                return
            self.pending.add(identity)
            self.status.set_text("Opening " + catalog[identity]["name"] + "…")
            def check_started():
                self.pending.discard(identity)
                if child.poll() not in (None, 0):
                    self.status.set_text("The puzzle could not open. Check its installation and try again.")
                else:
                    self.status.set_text("Opened " + catalog[identity]["name"] + ". Use its Game menu to save your place.")
                return False
            GLib.timeout_add(400, check_started)

        def help(self, *_):
            dialog = Gtk.MessageDialog(transient_for=self.window, modal=True, message_type=Gtk.MessageType.INFO,
                                       buttons=Gtk.ButtonsType.CLOSE, text="Puzzle Box help")
            dialog.format_secondary_text("Choose a puzzle with the pointer, or Tab and Enter. Ctrl+F searches the collection.\n\n"
                                         "Each puzzle opens in its own window. Try Type for board sizes or difficulty. "
                                         "Game offers New, Undo, Save and Load. Use Save to keep your place in a normal file; "
                                         "closing a game does not save it automatically.\n\n"
                                         "The games are Simon Tatham’s Portable Puzzle Collection, installed from Debian. "
                                         "Puzzle Box is the kidOS chooser; the games keep their original interface and credits.")
            dialog.run()
            dialog.destroy()

    return PuzzleBox().run(["puzzlebox"])


def main(arguments):
    if arguments:
        raise PuzzleError("Puzzle Box takes no game names, paths or command arguments.")
    if sys.platform != "linux" or os.getuid() < 1000:
        raise PuzzleError("Open Puzzle Box from the ordinary Linux desktop account.")
    os.umask(0o077)
    path = Path(__file__).with_name("puzzlebox-catalog.json")
    catalog, starters = validate_catalog(json.loads(path.read_text(encoding="utf-8")))
    return run_chooser(catalog, starters)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (PuzzleError, ImportError, ValueError, OSError) as error:
        print("Puzzle Box could not start: " + str(error), file=sys.stderr)
        sys.exit(1)
