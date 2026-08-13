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

    def chunk(self, text: str, file_type: str | None = None) -> list[dict[str, object]]:
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
                    **self._location_for_range(text, start, end, file_type),
                }
            )

        return output

    def _location_for_range(
        self,
        text: str,
        start: int,
        end: int,
        file_type: str | None,
    ) -> dict[str, object]:
        line_start = text.count("\n", 0, max(start, 0)) + 1
        line_end = text.count("\n", 0, max(end, start)) + 1
        prefix = text[: max(end, start)]
        normalized_type = (file_type or "").lower().lstrip(".")
        location: dict[str, object] = {
            "line_start": line_start,
            "line_end": line_end,
        }

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
