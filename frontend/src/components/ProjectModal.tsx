import React, { useEffect, useRef } from 'react';

export interface ProjectModalProps {
  id: string;
  title: string;
  description?: string | null;
  contentHtml?: string | null;
  tags?: string[] | string | null;
  status?: string | null;
  statusCode?: string | null;
  ctaUrl?: string | null;
  ctaLabel?: string | null;
  githubUrl?: string | null;
  demoUrl?: string | null;
  isOpen?: boolean;
  onClose?: () => void;
  children?: React.ReactNode;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  id,
  title,
  description,
  contentHtml,
  tags,
  status,
  statusCode,
  ctaUrl,
  ctaLabel,
  githubUrl,
  demoUrl,
  isOpen,
  onClose,
  children,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      onClose?.();
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (!('closedBy' in HTMLDialogElement.prototype) && event.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        const clickedInside =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;

        if (!clickedInside) {
          dialog.close();
        }
      }
    };

    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('click', handleClickOutside);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('click', handleClickOutside);
    };
  }, [onClose]);

  const tagsList: string[] = Array.isArray(tags)
    ? tags
    : typeof tags === 'string'
      ? tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

  const resolvedGithub = githubUrl || null;
  const resolvedCtaUrl = ctaUrl || resolvedGithub || demoUrl || null;
  const resolvedCtaLabel =
    ctaLabel ||
    (ctaUrl
      ? 'Перейти к проекту'
      : resolvedGithub
        ? 'Перейти на GitHub'
        : demoUrl
          ? 'Открыть демо'
          : 'Перейти к проекту');

  return (
    <dialog
      ref={dialogRef}
      id={id}
      className="modal"
      aria-labelledby={`${id}-title`}
      {...({ closedby: 'any' } as any)}
    >
      <header className="modal-header">
        <div className="modal-header-info">
          <h2 id={`${id}-title`} className="modal-title">
            {title}
          </h2>
          {(status || tagsList.length > 0) && (
            <div className="modal-meta-row">
              {status && (
                <span className="project-status" data-status={statusCode || ''}>
                  {status}
                </span>
              )}
              {tagsList.length > 0 && (
                <div className="modal-tags">
                  {tagsList.map((tag, idx) => (
                    <span key={idx} className="modal-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className="modal-close"
          onClick={() => {
            dialogRef.current?.close();
            onClose?.();
          }}
          data-modal-close
          aria-label={`Закрыть ${title}`}
        >
          <svg
            className="modal-close-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="modal-scroll">
        {description && <p className="modal-description">{description}</p>}

        {contentHtml && (
          <div
            className="markdown-body"
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />
        )}

        {children}
      </div>

      {(resolvedCtaUrl || resolvedGithub || demoUrl) && (
        <footer className="modal-footer">
          {resolvedCtaUrl && (
            <a
              href={resolvedCtaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
            >
              <span>{resolvedCtaLabel}</span>
              <span className="cta-arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          )}
          {resolvedGithub && resolvedCtaUrl !== resolvedGithub && (
            <a
              href={resolvedGithub}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-surface"
            >
              <span>GitHub</span>
              <span className="cta-arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          )}
          {demoUrl && resolvedCtaUrl !== demoUrl && (
            <a
              href={demoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-surface"
            >
              <span>Демо</span>
              <span className="cta-arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          )}
        </footer>
      )}
    </dialog>
  );
};

export default ProjectModal;
