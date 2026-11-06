const paths = {
  inbox: "M3 13h4l1.5 2.5h3L13 13h4M3 13l2-8h10l2 8v4H3z",
  sent: "M3 10l14-6-6 14-2-6z",
  all: "M3 6h14M3 10h14M3 14h14",
  pencil: "M4 16l1-4 8-8 3 3-8 8zM12 5l3 3",
  gear: "M10 7a3 3 0 100 6 3 3 0 000-6zM10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4",
  reply: "M8 5L3 10l5 5M3 10h9a5 5 0 015 5v1",
  replyAll: "M9 5L4 10l5 5M6 5L1 10l5 5M4 10h8a5 5 0 015 5v1",
  forward: "M12 5l5 5-5 5M17 10H8a5 5 0 00-5 5v1",
  trash: "M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11",
  unread: "M3 5h14v10H3zM3 5l7 6 7-6",
  back: "M12 4l-6 6 6 6",
  clip: "M14 7l-6 6a2 2 0 01-3-3l7-7a3.5 3.5 0 015 5l-7 7",
  close: "M5 5l10 10M15 5L5 15",
  refresh: "M16 10a6 6 0 11-2-4.5M16 3v4h-4",
  download: "M10 3v10M6 9l4 4 4-4M4 16h12",
};

export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
