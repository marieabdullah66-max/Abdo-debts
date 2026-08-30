"""Tiny BIFF8 (.xls) reader used for reports exported by the pharmacy system.

It intentionally reads values only from the first worksheet and supports the cell
records used by the system's legacy Excel export (LABELSST/NUMBER/RK/MULRK/LABEL).
This avoids a heavy runtime dependency just to parse the old .xls format.
"""
from __future__ import annotations

import collections
import struct
from typing import Any

FREE = 0xFFFFFFFF
ENDOF = 0xFFFFFFFE


def _decode_rk(rk: int) -> float | int:
    mult100 = rk & 1
    is_int = rk & 2
    if is_int:
        value: float | int = struct.unpack("<i", struct.pack("<I", rk))[0] >> 2
    else:
        bits = (rk & 0xFFFFFFFC) << 32
        value = struct.unpack("<d", struct.pack("<Q", bits))[0]
    if mult100:
        value = value / 100
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


class _SegmentReader:
    def __init__(self, segments: list[bytes]):
        self.segments = segments
        self.segment_index = 0
        self.offset = 0

    def _remaining(self) -> int:
        if self.segment_index >= len(self.segments):
            return 0
        return len(self.segments[self.segment_index]) - self.offset

    def _next_segment(self) -> None:
        self.segment_index += 1
        self.offset = 0

    def raw(self, count: int) -> bytes:
        out = bytearray()
        while count:
            if self.segment_index >= len(self.segments):
                raise ValueError("Unexpected end of SST")
            remaining = self._remaining()
            if remaining == 0:
                self._next_segment()
                continue
            take = min(remaining, count)
            out += self.segments[self.segment_index][self.offset:self.offset + take]
            self.offset += take
            count -= take
        return bytes(out)

    def u8(self) -> int:
        return self.raw(1)[0]

    def u16(self) -> int:
        return struct.unpack("<H", self.raw(2))[0]

    def u32(self) -> int:
        return struct.unpack("<I", self.raw(4))[0]

    def chars(self, count: int, high_byte: bool) -> str:
        parts: list[str] = []
        high = high_byte
        while count:
            if self._remaining() == 0:
                self._next_segment()
                if self.segment_index >= len(self.segments):
                    raise ValueError("Unexpected end of SST string")
                high = bool(self.u8() & 1)
            bytes_per_char = 2 if high else 1
            available = self._remaining() // bytes_per_char
            take = min(count, available)
            if take <= 0:
                raise ValueError("Invalid SST continuation")
            raw = self.raw(take * bytes_per_char)
            parts.append(raw.decode("utf-16le" if high else "latin1", "replace"))
            count -= take
        return "".join(parts)


def read_first_sheet_rows(content: bytes, *, max_rows: int = 100000, max_cols: int = 128) -> list[list[Any]]:
    """Return first-sheet cell values from a BIFF8 .xls byte string."""
    if len(content) < 512 or content[:8] != bytes.fromhex("D0CF11E0A1B11AE1"):
        raise ValueError("Not an OLE2/BIFF .xls file")

    sector_size = 1 << struct.unpack_from("<H", content, 30)[0]
    mini_sector_size = 1 << struct.unpack_from("<H", content, 32)[0]
    num_fat = struct.unpack_from("<I", content, 44)[0]
    first_dir = struct.unpack_from("<I", content, 48)[0]
    mini_cutoff = struct.unpack_from("<I", content, 56)[0]
    first_minifat = struct.unpack_from("<I", content, 60)[0]
    num_minifat = struct.unpack_from("<I", content, 64)[0]
    first_difat = struct.unpack_from("<I", content, 68)[0]
    num_difat = struct.unpack_from("<I", content, 72)[0]

    def sector_bytes(sid: int) -> bytes:
        start = 512 + sid * sector_size
        return content[start:start + sector_size]

    fat_sids = [x for x in struct.unpack_from("<109I", content, 76) if x not in (FREE, ENDOF)]
    sid = first_difat
    for _ in range(num_difat):
        if sid in (FREE, ENDOF):
            break
        values = struct.unpack("<%dI" % (sector_size // 4), sector_bytes(sid))
        fat_sids.extend(x for x in values[:-1] if x not in (FREE, ENDOF))
        sid = values[-1]
    fat_sids = fat_sids[:num_fat]

    fat: list[int] = []
    for fat_sid in fat_sids:
        fat.extend(struct.unpack("<%dI" % (sector_size // 4), sector_bytes(fat_sid)))

    def chain(start: int, table: list[int], *, cap: int = 200000) -> list[int]:
        result: list[int] = []
        seen: set[int] = set()
        current = start
        while current not in (FREE, ENDOF) and current < len(table) and current not in seen and len(result) < cap:
            seen.add(current)
            result.append(current)
            current = table[current]
        return result

    def regular_stream(start: int, size: int | None = None) -> bytes:
        data = b"".join(sector_bytes(x) for x in chain(start, fat))
        return data if size is None else data[:size]

    directory = regular_stream(first_dir)
    entries: list[tuple[str, int, int, int]] = []
    for offset in range(0, len(directory), 128):
        entry = directory[offset:offset + 128]
        if len(entry) < 128:
            break
        name_len = struct.unpack_from("<H", entry, 64)[0]
        name = entry[:name_len - 2].decode("utf-16le", "replace") if name_len >= 2 else ""
        entries.append((name, entry[66], struct.unpack_from("<I", entry, 116)[0], struct.unpack_from("<Q", entry, 120)[0]))

    root = next((x for x in entries if x[1] == 5), None)
    workbook_entry = next((x for x in entries if x[0].casefold() in {"workbook", "book"}), None)
    if not root or not workbook_entry:
        raise ValueError("Workbook stream not found")

    minifat: list[int] = []
    if num_minifat and first_minifat not in (FREE, ENDOF):
        raw = regular_stream(first_minifat, num_minifat * sector_size)
        minifat = list(struct.unpack("<%dI" % (len(raw) // 4), raw[:len(raw) // 4 * 4]))
    ministream = regular_stream(root[2], root[3])

    def entry_stream(entry: tuple[str, int, int, int]) -> bytes:
        _, entry_type, start, size = entry
        if entry_type == 2 and size < mini_cutoff and minifat:
            chunks = []
            for mini_sid in chain(start, minifat):
                start_offset = mini_sid * mini_sector_size
                chunks.append(ministream[start_offset:start_offset + mini_sector_size])
            return b"".join(chunks)[:size]
        return regular_stream(start, size)

    workbook = entry_stream(workbook_entry)
    records: list[tuple[int, int, bytes]] = []
    pos = 0
    while pos + 4 <= len(workbook):
        record_id, length = struct.unpack_from("<HH", workbook, pos)
        payload = workbook[pos + 4:pos + 4 + length]
        if len(payload) < length:
            break
        records.append((pos, record_id, payload))
        pos += 4 + length

    # Shared String Table (SST) plus immediately following CONTINUE records.
    strings: list[str] = []
    sst_index = next((i for i, rec in enumerate(records) if rec[1] == 0x00FC), None)
    if sst_index is not None:
        segments = [records[sst_index][2]]
        i = sst_index + 1
        while i < len(records) and records[i][1] == 0x003C:
            segments.append(records[i][2])
            i += 1
        reader = _SegmentReader(segments)
        reader.u32()  # total strings
        unique = reader.u32()
        for _ in range(unique):
            char_count = reader.u16()
            options = reader.u8()
            rich = bool(options & 0x08)
            extended = bool(options & 0x04)
            high_byte = bool(options & 0x01)
            rich_runs = reader.u16() if rich else 0
            ext_size = reader.u32() if extended else 0
            value = reader.chars(char_count, high_byte)
            if rich_runs:
                reader.raw(4 * rich_runs)
            if ext_size:
                reader.raw(ext_size)
            strings.append(value)

    sheet_offset = next((struct.unpack_from("<I", payload, 0)[0] for _, rid, payload in records if rid == 0x0085), None)
    if sheet_offset is None:
        raise ValueError("Worksheet not found")
    start_index = next((i for i, rec in enumerate(records) if rec[0] == sheet_offset), None)
    if start_index is None:
        raise ValueError("Worksheet stream not found")

    cells: dict[int, dict[int, Any]] = collections.defaultdict(dict)
    for record_pos, record_id, payload in records[start_index:]:
        if record_id == 0x000A and record_pos > sheet_offset:
            break
        try:
            if record_id == 0x00FD:  # LABELSST
                row, col, _xf, string_index = struct.unpack_from("<HHHI", payload, 0)
                if row < max_rows and col < max_cols:
                    cells[row][col] = strings[string_index] if string_index < len(strings) else ""
            elif record_id == 0x0203:  # NUMBER
                row, col, _xf = struct.unpack_from("<HHH", payload, 0)
                if row < max_rows and col < max_cols:
                    value = struct.unpack_from("<d", payload, 6)[0]
                    cells[row][col] = int(value) if value.is_integer() else value
            elif record_id == 0x027E:  # RK
                row, col, _xf, rk = struct.unpack_from("<HHHI", payload, 0)
                if row < max_rows and col < max_cols:
                    cells[row][col] = _decode_rk(rk)
            elif record_id == 0x00BD:  # MULRK
                row, first_col = struct.unpack_from("<HH", payload, 0)
                last_col = struct.unpack_from("<H", payload, len(payload) - 2)[0]
                if row < max_rows:
                    for index, col in enumerate(range(first_col, last_col + 1)):
                        if col >= max_cols:
                            continue
                        _xf, rk = struct.unpack_from("<HI", payload, 4 + index * 6)
                        cells[row][col] = _decode_rk(rk)
            elif record_id == 0x0204:  # LABEL (legacy inline string)
                row, col, _xf = struct.unpack_from("<HHH", payload, 0)
                if row < max_rows and col < max_cols:
                    length = struct.unpack_from("<H", payload, 6)[0]
                    cells[row][col] = payload[8:8 + length].decode("latin1", "replace")
        except (struct.error, IndexError, ValueError):
            continue

    if not cells:
        return []
    last_row = min(max(cells), max_rows - 1)
    last_col = min(max((max(row) for row in cells.values() if row), default=-1), max_cols - 1)
    result: list[list[Any]] = []
    for row_index in range(last_row + 1):
        row = [cells[row_index].get(col) for col in range(last_col + 1)]
        while row and row[-1] is None:
            row.pop()
        result.append(row)
    return result
