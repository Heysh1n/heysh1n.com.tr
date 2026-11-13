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
      className="modal glassmorphism"
      aria-labelledby={`${id}-title`}
      {...({ closedby: 'any' } as any)}
    >
      <div className="modal_inner">
        <div className="modal_header">
          <div className="modal_header_info">
            <h2 id={`${id}-title`} className="modal_title">
              {title}
            </h2>
            <div className="modal_meta_row">
              {status && (
                <span className="project_status" data-status={statusCode || ''}>
                  {status}
                </span>
              )}
              {tagsList.length > 0 && (
                <div className="modal_tags">
                  {tagsList.map((tag, idx) => (
                    <span key={idx} className="modal_tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            className="modal_close"
            onClick={() => {
              dialogRef.current?.close();
              onClose?.();
            }}
            data-modal-close
            aria-label={`Закрыть ${title}`}
          >
            ✕
          </button>
        </div>

        {description && <p className="modal_description">{description}</p>}

        {contentHtml && (
          <div
            className="modal_body markdown-body"
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />
        )}

        {children}

        {(resolvedCtaUrl || resolvedGithub || demoUrl) && (
          <div className="modal_footer">
            {resolvedCtaUrl && (
              <a
                href={resolvedCtaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="modal_cta_primary"
              >
                <span>{resolvedCtaLabel}</span>
                <span className="cta_arrow" aria-hidden="true">
                  ↗
                </span>
              </a>
            )}
            {resolvedGithub && resolvedCtaUrl !== resolvedGithub && (
              <a
                href={resolvedGithub}
                target="_blank"
                rel="noopener noreferrer"
                className="modal_cta_secondary"
              >
                <span>GitHub</span>
                <span className="cta_arrow" aria-hidden="true">
                  →
                </span>
              </a>
            )}
            {demoUrl && resolvedCtaUrl !== demoUrl && (
              <a
                href={demoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="modal_cta_secondary"
              >
                <span>Демо</span>
                <span className="cta_arrow" aria-hidden="true">
                  ↗
                </span>
              </a>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
};

export default ProjectModal;
