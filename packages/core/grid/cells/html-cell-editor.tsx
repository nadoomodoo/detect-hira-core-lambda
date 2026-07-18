// @ts-nocheck
import '@toast-ui/editor/dist/toastui-editor.css';
import '@toast-ui/editor/dist/toastui-editor-viewer.css';
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css';
import * as React from 'react';
import { Editor, Viewer } from '@toast-ui/react-editor';
import styled from '@emotion/styled';
import { ProvideEditorComponent } from '../internal/data-grid/data-grid-types';
import { HtmlCell } from './html-cell-types';
import { useRef } from 'react';

const Wrapper = styled.div`
  .gdg-footer {
    display: flex;
    justify-content: flex-end;
    padding: 20px;
    border-top: 1px solid var(--gdg-border-color);

    button {
      border: none;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 500;
      font-family: var(--gdg-font-family);
      cursor: pointer;
      border-radius: var(--gdg-rounding-radius, 9px);
      transition: all 0.2s;
    }
  }

  .gdg-save-button {
    background-color: var(--gdg-accent-color);
    color: var(--gdg-accent-fg);

    &:hover {
      opacity: 0.9;
    }
  }

  .gdg-close-button {
    background-color: var(--gdg-bg-header);
    color: var(--gdg-text-medium);
    margin-right: 8px;

    &:hover {
      background-color: var(--gdg-bg-hover);
    }
  }
`;

const HtmlCellEditor: ProvideEditorComponent<HtmlCell> = (p) => {
  const editorRef = useRef<Editor>(null);

  const onKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
  }, []);

  const onSave = React.useCallback(() => {
    const newValue = editorRef.current?.getInstance()?.getHTML() ?? '';
    p.onFinishedEditing({
      ...p.value,
      data: {
        ...p.value.data,
        html: newValue,
      },
    });
  }, [p, editorRef.current?.getInstance()]);

  const onClose = React.useCallback(() => {
    p.onFinishedEditing(undefined);
  }, [p]);

  if (p.value.readonly) {
    return (
      <Wrapper
        id="gdg-html-readonly"
        onKeyDown={onKeyDown}
        style={{ height: '75vh', padding: '35px' }}
      >
        <Viewer initialValue={p.value.data.html} usageStatistics={false} />
      </Wrapper>
    );
  }

  return (
    <Wrapper id="gdg-html-wysiwyg" onKeyDown={onKeyDown}>
      <Editor
        ref={editorRef}
        initialEditType="wysiwyg"
        autofocus={false}
        initialValue={p.value.data.html || '<p></p>'}
        height="75vh"
        usageStatistics={false}
        previewStyle="vertical"
        previewHighlight={false}
        hideModeSwitch={true}
        useCommandShortcut={true}
        minHeight="500px"
        toolbarItems={[
          ['heading', 'bold', 'italic', 'strike'],
          ['hr', 'quote'],
          ['ul', 'ol', 'task', 'indent', 'outdent'],
          ['table', 'link'],
          ['code', 'codeblock'],
          ['image'],
        ]}
      />
      <div className="gdg-footer">
        <button className="gdg-close-button" onClick={onClose}>
          Close
        </button>
        <button className="gdg-save-button" onClick={onSave}>
          Save
        </button>
      </div>
    </Wrapper>
  );
};

export default HtmlCellEditor;
