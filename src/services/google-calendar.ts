interface EventData {
  title: string;
  startDate: Date;
  durationMinutes?: number;
  description?: string;
  priority?: "low" | "medium" | "high";
  location?: string;
}

export function generateGoogleCalendarUrl(event: EventData): string {
  const baseUrl = "https://www.google.com/calendar/render?action=TEMPLATE";

  // Formato ISO UTC que requiere Google: YYYYMMDDTHHMMSSZ
  const formatForGoogle = (date: Date) => {
    return date.toISOString().replace(/-|:|\.\d\d\d/g, "");
  };

  const duration = event.durationMinutes ?? 60; // 60 min por defecto
  const endDate = new Date(event.startDate.getTime() + duration * 60 * 1000);

  const startStr = formatForGoogle(event.startDate);
  const endStr = formatForGoogle(endDate);

  // Detalles enriquecidos
  const descriptionParts = [
    event.description ? `Descripción: ${event.description}` : "",
    event.priority ? `Prioridad: ${event.priority.toUpperCase()}` : "",
    `Creado vía Telegram Bot`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const titleWithPriority = event.priority
    ? `[${event.priority.toUpperCase()}] ${event.title}`
    : event.title;

  const params = new URLSearchParams({
    text: titleWithPriority,
    dates: `${startStr}/${endStr}`,
    details: descriptionParts,
    location: event.location || "",
    sf: "true",
    output: "xml",
  });

  return `${baseUrl}&${params.toString()}`;
}
