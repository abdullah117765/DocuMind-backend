from langchain_text_splitters import RecursiveCharacterTextSplitter
import re

from app.config.settings import get_settings

PAGE_MARKER = re.compile(r"---\s*Page\s+(\d+)\s*---", re.IGNORECASE)
SLIDE_MARKER = re.compile(r"---\s*Slide\s+(\d+)\s*---", re.IGNORECASE)
SHEET_MARKER = re.compile(r"---\s*Sheet:\s*(.*?)\s*---", re.IGNORECASE)
PARAGRAPH_MARKER = re.compile(r"---\s*Paragraph\s+(\d+)\s*---", re.IGNORECASE)
TABLE_MARKER = re.compile(r"---\s*Table\s+(\d+)\s*---", re.IGNORECASE)
IMAGE_MARKER = re.compile(r"---\s*Image OCR text\s*---", re.IGNORECASE)


class ChunkingService:
    def __init__(self) -> None:
        settings = get_settings()
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=settings.CHUNK_SIZE,
            chunk_overlap=settings.CHUNK_OVERLAP,
            separators=["\n\n", "\n", ". ", " ", ""],
            length_function=len,
        )

    def chunk(
        self,
        text: str,
        file_type: str | None = None,
        locations: list[dict[str, object]] | None = None,
    ) -> list[dict[str, object]]:
        if not text.strip():
            return []

        chunks = self.splitter.split_text(text)
        output = []
        cursor = 0

        for index, chunk in enumerate(chunks):
            start = text.find(chunk, cursor)
            if start < 0:
                start = cursor
            end = start + len(chunk)
            cursor = max(start, end - 1)

            output.append(
                {
                    "text": chunk,
                    "index": index,
                    "char_start": start,
                    "char_end": end,
                    **self._location_for_range(
                        text,
                        start,
                        end,
                        file_type,
                        locations=locations,
                    ),
                }
            )

        return output

    def _location_for_range(
        self,
        text: str,
        start: int,
        end: int,
        file_type: str | None,
        locations: list[dict[str, object]] | None = None,
    ) -> dict[str, object]:
        line_start = text.count("\n", 0, max(start, 0)) + 1
        line_end = text.count("\n", 0, max(end, start)) + 1
        prefix = text[: max(end, start)]
        normalized_type = (file_type or "").lower().lstrip(".")
        location: dict[str, object] = {
            "line_start": line_start,
            "line_end": line_end,
        }
        exact_location = self._location_from_overlapping_blocks(locations, start, end)

        if exact_location:
            location.update(exact_location)
            return location

        page_number = self._last_int_marker(PAGE_MARKER, prefix)
        if page_number is not None:
            location.update(
                {
                    "location_type": "page",
                    "page_number": page_number,
                    "location_label": f"Page {page_number}",
                }
            )
            return location

        slide_number = self._last_int_marker(SLIDE_MARKER, prefix)
        if slide_number is not None:
            location.update(
                {
                    "location_type": "slide",
                    "slide_number": slide_number,
                    "location_label": f"Slide {slide_number}",
                }
            )
            return location

        sheet_name = self._last_string_marker(SHEET_MARKER, prefix)
        if sheet_name:
            location.update(
                {
                    "location_type": "sheet",
                    "sheet_name": sheet_name,
                    "location_label": f'Sheet "{sheet_name}", lines {line_start}-{line_end}',
                }
            )
            return location

        paragraph_number = self._last_int_marker(PARAGRAPH_MARKER, prefix)
        if paragraph_number is not None:
            location.update(
                {
                    "location_type": "paragraph",
                    "section_title": f"Paragraph {paragraph_number}",
                    "location_label": f"Paragraph {paragraph_number}",
                }
            )
            return location

        table_number = self._last_int_marker(TABLE_MARKER, prefix)
        if table_number is not None:
            location.update(
                {
                    "location_type": "table",
                    "section_title": f"Table {table_number}",
                    "location_label": f"Table {table_number}, lines {line_start}-{line_end}",
                }
            )
            return location

        if IMAGE_MARKER.search(prefix):
            location.update(
                {
                    "location_type": "image",
                    "location_label": "Image OCR text",
                }
            )
            return location

        location.update(
            {
                "location_type": "lines",
                "location_label": (
                    f"Lines {line_start}-{line_end}"
                    if line_start != line_end
                    else f"Line {line_start}"
                ),
            }
        )

        if normalized_type == "json":
            location["section_title"] = "JSON text"
        elif normalized_type == "xml":
            location["section_title"] = "XML text"
        elif normalized_type == "html":
            location["section_title"] = "HTML text"

        return location

    def _last_int_marker(self, pattern: re.Pattern[str], text: str) -> int | None:
        matches = list(pattern.finditer(text))

        if not matches:
            return None

        try:
            return int(matches[-1].group(1))
        except (TypeError, ValueError):
            return None

    def _last_string_marker(self, pattern: re.Pattern[str], text: str) -> str | None:
        matches = list(pattern.finditer(text))

        if not matches:
            return None

        value = matches[-1].group(1).strip()

        return value or None

    def _location_from_overlapping_blocks(
        self,
        locations: list[dict[str, object]] | None,
        start: int,
        end: int,
    ) -> dict[str, object] | None:
        if not locations:
            return None

        overlapping: list[tuple[int, dict[str, object]]] = []

        for location in locations:
            location_start = self._safe_non_negative_int(location.get("char_start"))
            location_end = self._safe_int(location.get("char_end"))

            if location_start is None or location_end is None:
                continue

            overlap = max(0, min(end, location_end) - max(start, location_start))
            if overlap > 0:
                overlapping.append((overlap, location))

        if not overlapping:
            return None

        overlapping.sort(key=lambda item: item[0], reverse=True)
        primary = overlapping[0][1]
        highlight_boxes = []

        for _, location in overlapping[:8]:
            bbox = location.get("bbox")
            if isinstance(bbox, dict):
                highlight_boxes.append(
                    {
                        "page_number": location.get("page_number"),
                        "x0": bbox.get("x0"),
                        "y0": bbox.get("y0"),
                        "x1": bbox.get("x1"),
                        "y1": bbox.get("y1"),
                        "page_width": bbox.get("page_width"),
                        "page_height": bbox.get("page_height"),
                    }
                )

        page_number = self._safe_int(primary.get("page_number"))
        location_label = primary.get("location_label")

        return {
            "location_type": primary.get("location_type") or "page",
            "location_label": location_label or (f"Page {page_number}" if page_number else "Document location"),
            "page_number": page_number,
            "preview_type": primary.get("preview_type") or "pdf",
            "source_file_type": primary.get("source_file_type"),
            "highlight_boxes": highlight_boxes,
        }

    def _safe_non_negative_int(self, value: object) -> int | None:
        try:
            number = int(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None

        return number if number >= 0 else None

    def _safe_int(self, value: object) -> int | None:
        try:
            number = int(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None

        return number if number > 0 else None

