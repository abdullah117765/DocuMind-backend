import logging
import time
from functools import cached_property

from app.config.settings import get_settings
from app.models.rag import RagSearchResult


logger = logging.getLogger(__name__)


class LlmService:
    @cached_property
    def client(self):
        from google import genai
        from google.genai import types

        settings = get_settings()

        return genai.Client(
            api_key=settings.GEMINI_API_KEY,
            http_options=types.HttpOptions(timeout=settings.GEMINI_REQUEST_TIMEOUT_MS),
        )

    @property
    def is_available(self) -> bool:
        return bool(get_settings().GEMINI_API_KEY.strip())

    def answer(self, query: str, results: list[RagSearchResult]) -> tuple[str, str | None, bool]:
        settings = get_settings()

        if not self.is_available:
            return (
                "AI answer generation is not configured yet. Search results are available below.",
                None,
                False,
            )

        started = time.perf_counter()
        deadline = time.monotonic() + (settings.GEMINI_TOTAL_TIMEOUT_MS / 1000)
        max_attempts = max(settings.GEMINI_MAX_RETRIES, 0) + 1
        prompt = self._build_prompt(query, results)
        last_error: Exception | None = None

        logger.info(
            "RAG LLM request started model=%s context_chunks=%s max_attempts=%s total_timeout_ms=%s",
            settings.GEMINI_MODEL,
            len(results),
            max_attempts,
            settings.GEMINI_TOTAL_TIMEOUT_MS,
        )

        for attempt in range(1, max_attempts + 1):
            remaining_ms = int(max((deadline - time.monotonic()) * 1000, 0))

            if remaining_ms <= 0:
                break

            request_timeout_ms = min(
                max(settings.GEMINI_REQUEST_TIMEOUT_MS, 1),
                remaining_ms,
            )

            try:
                response = self.client.models.generate_content(
                    model=settings.GEMINI_MODEL,
                    contents=prompt,
                    config={"http_options": {"timeout": request_timeout_ms}},
                )
                logger.info(
                    "RAG LLM request completed model=%s attempt=%s elapsed_ms=%s",
                    settings.GEMINI_MODEL,
                    attempt,
                    int((time.perf_counter() - started) * 1000),
                )

                return (
                    response.text or "No answer was generated.",
                    settings.GEMINI_MODEL,
                    True,
                )
            except Exception as error:
                last_error = error
                retryable = self._is_retryable_error(error)

                if not retryable or attempt >= max_attempts:
                    logger.warning(
                        "RAG LLM request failed model=%s attempt=%s retryable=%s elapsed_ms=%s error=%s",
                        settings.GEMINI_MODEL,
                        attempt,
                        retryable,
                        int((time.perf_counter() - started) * 1000),
                        self._safe_error_message(error),
                    )
                    break

                delay_ms = self._retry_delay_ms(settings, attempt)
                remaining_after_attempt_ms = int(
                    max((deadline - time.monotonic()) * 1000, 0)
                )

                if delay_ms >= remaining_after_attempt_ms:
                    logger.warning(
                        "RAG LLM retry skipped model=%s attempt=%s remaining_ms=%s error=%s",
                        settings.GEMINI_MODEL,
                        attempt,
                        remaining_after_attempt_ms,
                        self._safe_error_message(error),
                    )
                    break

                logger.warning(
                    "RAG LLM retry scheduled model=%s attempt=%s next_delay_ms=%s error=%s",
                    settings.GEMINI_MODEL,
                    attempt,
                    delay_ms,
                    self._safe_error_message(error),
                )
                time.sleep(delay_ms / 1000)

        if last_error:
            logger.warning(
                "RAG LLM request exhausted model=%s elapsed_ms=%s final_error=%s",
                settings.GEMINI_MODEL,
                int((time.perf_counter() - started) * 1000),
                self._safe_error_message(last_error),
            )

        return (
            "AI answer generation is temporarily unavailable. Search results are available below.",
            settings.GEMINI_MODEL,
            False,
        )

    def _retry_delay_ms(self, settings: object, attempt: int) -> int:
        initial = max(int(getattr(settings, "GEMINI_RETRY_INITIAL_BACKOFF_MS")), 0)
        maximum = max(int(getattr(settings, "GEMINI_RETRY_MAX_BACKOFF_MS")), initial)

        return min(initial * (2 ** (attempt - 1)), maximum)

    def _is_retryable_error(self, error: Exception) -> bool:
        status_code = self._status_code(error)

        if status_code in {429, 500, 502, 503, 504}:
            return True

        if status_code in {400, 401, 403, 404}:
            return False

        message = str(error).lower()
        retryable_markers = (
            "429",
            "resource_exhausted",
            "rate limit",
            "too many requests",
            "timeout",
            "timed out",
            "deadline",
            "temporarily unavailable",
            "service unavailable",
            "internal",
            "502",
            "503",
            "504",
        )
        non_retryable_markers = (
            "api key not valid",
            "invalid api key",
            "permission denied",
            "unauthenticated",
            "unsupported model",
            "model not found",
            "invalid argument",
        )

        if any(marker in message for marker in non_retryable_markers):
            return False

        return any(marker in message for marker in retryable_markers)

    def _status_code(self, error: Exception) -> int | None:
        for attribute in ("status_code", "code"):
            value = getattr(error, attribute, None)

            try:
                if value is not None:
                    return int(value)
            except (TypeError, ValueError):
                continue

        return None

    def _safe_error_message(self, error: Exception) -> str:
        return str(error).replace("\n", " ")[:500]

    def _build_prompt(self, query: str, results: list[RagSearchResult]) -> str:
        excerpts = []

        for index, result in enumerate(results, start=1):
            excerpts.append(
                "\n".join(
                    [
                        f'Source [{index}] "{result.document_name}" '
                        f"(version {result.version_number}, chunk {result.chunk_index + 1}):",
                        result.text,
                    ]
                )
            )

        return "\n\n".join(
            [
                "You are Documind AI, a careful assistant inside a production document intelligence SaaS platform.",
                "Your job is to answer the user's question using ONLY the document excerpts provided below.",
                "",
                "Answer rules:",
                "- Start with a direct answer in 1-2 sentences.",
                "- Return clean Markdown.",
                "- Then add concise bullet points only if they make the answer clearer.",
                "- Put every bullet on its own line starting with '- '. Never write bullets inline inside a paragraph.",
                "- Leave a blank line before and after bullet lists.",
                "- Use bold only for short labels inside bullets, for example '- **Requirement:** ...'.",
                "- Cite evidence naturally using source numbers like [1] or [2].",
                "- Do not mention chunk numbers unless the user asks for technical trace details.",
                "- If excerpts disagree, explain the conflict and cite both sources.",
                "- If the excerpts are weak or incomplete, say exactly what is missing.",
                "- If the answer is not present in the excerpts, say: \"I could not find this in the selected documents.\"",
                "- Do not use outside knowledge. Do not guess. Do not invent names, dates, policies, amounts, or steps.",
                "- Keep the tone professional, clean, and easy for a business user to understand.",
                "- Avoid filler phrases such as \"Based on the provided documents\" unless needed.",
                "- If the user asks for a summary, produce a short executive summary with key points.",
                "- If the user asks for a process/policy, format it as steps or requirements.",
                "- If the user asks a yes/no question, answer yes/no first, then explain.",
                "",
                "Document excerpts:",
                "\n\n".join(excerpts) or "No excerpts were found.",
                "",
                f"User question: {query}",
                "",
                "Final answer:",
            ]
        )
