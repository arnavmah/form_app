/**
 * Question Input Component
 * 
 * Renders the appropriate input element based on question type.
 * Supports side-by-side layout for question image and options with images.
 */

'use client';

import React from 'react';
import type { FormQuestion, QuestionOption } from '@/lib/db';
import { OfflineImage } from './OfflineImage';
import { ImagePopup } from './ImagePopup';
import { detectScriptDirection } from '@/lib/scriptUtils';

interface QuestionInputProps {
    question: FormQuestion;
    value: AnswerValue;
    onChange: (value: AnswerValue) => void;
    questionNumber: number;
}

export type AnswerValue = {
    text?: string;
    selectedOptions?: number[];
    rankingOrder?: number[];
    file?: File;
    imageUrl?: string;
    localImageId?: number;
};

export function QuestionInput({ question, value, onChange, questionNumber }: QuestionInputProps) {
    const [selectedImage, setSelectedImage] = React.useState<string | null>(null);
    const requiredMarker = question.is_required ? ' *' : '';
    
    // Resolve question marks: check question.marks first, then check option marks for MCQs/Multiple Select
    const calculatedMarks = React.useMemo(() => {
        if (question.marks !== null && question.marks !== undefined && Number(question.marks) > 0) {
            return Number(question.marks);
        }
        if (question.options && question.options.length > 0) {
            if (question.question_type === 'multiple_select') {
                const sum = question.options.reduce((acc, opt) => {
                    const m = opt.marks ? parseFloat(String(opt.marks)) : 0;
                    return opt.is_correct && m > 0 ? acc + m : acc;
                }, 0);
                if (sum > 0) return sum;
            } else {
                const correctOpt = question.options.find(opt => opt.is_correct);
                if (correctOpt?.marks && Number(correctOpt.marks) > 0) {
                    return Number(correctOpt.marks);
                }
                const maxOptMark = Math.max(...question.options.map(opt => Number(opt.marks) || 0));
                if (maxOptMark > 0) return maxOptMark;
            }
        }
        return question.marks !== null && question.marks !== undefined && Number(question.marks) > 0 ? Number(question.marks) : null;
    }, [question]);

    const marksText = calculatedMarks !== null && calculatedMarks !== undefined && calculatedMarks > 0
        ? `[${calculatedMarks} ${calculatedMarks === 1 ? 'mark' : 'marks'}]`
        : '';

    const qDir = detectScriptDirection(question.question_text);

    // Check if options have images
    const hasOptionImages = question.options.some(opt => opt.option_image_url);

    return (
        <div className="question-container" dir={qDir}>
            {/* Question Header */}
            <div className="question-header" dir={qDir}>
                <span className="question-number">Q{questionNumber}.</span>
                <span className="question-text" dir={qDir}>
                    {question.question_text}
                    {requiredMarker && <span className="question-required" style={{ color: 'var(--color-error)' }}>{requiredMarker}</span>}
                </span>
                {marksText && <span className="question-marks">{marksText}</span>}
            </div>

            {/* Question Image + Content Layout */}
            <div className={`question-body ${question.question_image_url ? 'with-image' : ''}`}>
                {/* Question Image */}
                {question.question_image_url && (
                    <div className="question-image-container">
                        <OfflineImage
                            src={question.question_image_url}
                            alt="Question"
                            className="question-img"
                            style={{ cursor: 'zoom-in' }}
                            onClick={() => setSelectedImage(question.question_image_url!)}
                        />
                        <a
                            href="#"
                            onClick={(e) => {
                                e.preventDefault();
                                setSelectedImage(question.question_image_url!);
                            }}
                            className="image-link"
                        >
                            Open image
                        </a>
                    </div>
                )}

                {/* Input based on question type */}
                <div className="question-input-area">
                    {renderInput(question, value, onChange, hasOptionImages, setSelectedImage)}
                </div>
            </div>

            {selectedImage && (
                <ImagePopup 
                    src={selectedImage} 
                    onClose={() => setSelectedImage(null)} 
                />
            )}
        </div>
    );
}

function renderInput(
    question: FormQuestion,
    value: AnswerValue,
    onChange: (value: AnswerValue) => void,
    hasOptionImages: boolean,
    onImageClick: (url: string) => void
) {
    switch (question.question_type) {
        case 'mcq':
            return (
                <MCQInput
                    options={question.options}
                    value={value.selectedOptions?.[0]}
                    onChange={(optionId) => onChange({ selectedOptions: optionId !== undefined ? [optionId] : [] })}
                    hasImages={hasOptionImages}
                    onImageClick={onImageClick}
                />
            );

        case 'multiple_select':
            return (
                <MultipleSelectInput
                    options={question.options}
                    value={value.selectedOptions || []}
                    onChange={(selected) => onChange({ selectedOptions: selected })}
                    hasImages={hasOptionImages}
                    onImageClick={onImageClick}
                />
            );

        case 'true_false':
            return (
                <TrueFalseInput
                    value={value.text}
                    onChange={(text) => onChange({ text: text || '' })}
                />
            );

        case 'fill_blank':
        case 'short_answer':
            return (
                <TextInput
                    value={value.text || ''}
                    onChange={(text) => onChange({ text })}
                />
            );

        case 'long_answer':
            return (
                <TextAreaInput
                    value={value.text || ''}
                    onChange={(text) => onChange({ text })}
                />
            );

        case 'numerical':
            return (
                <NumberInput
                    value={value.text || ''}
                    onChange={(text) => onChange({ text })}
                />
            );

        case 'range':
            return (
                <RangeInput
                    min={question.min_value || 1}
                    max={question.max_value || 10}
                    value={parseInt(value.text || '1', 10)}
                    onChange={(num) => onChange({ text: String(num) })}
                />
            );

        case 'ranking':
            return (
                <RankingInput
                    options={question.options}
                    value={value.rankingOrder || []}
                    onChange={(order) => onChange({ rankingOrder: order })}
                    onImageClick={onImageClick}
                />
            );

        case 'image_upload':
            return (
                <ImageUploadInput
                    value={value.file}
                    onChange={(file) => onChange({ file })}
                />
            );

        default:
            return <p className="text-red-500">Unknown question type: {question.question_type}</p>;
    }
}

// ============ MCQ INPUT ============

function MCQInput({
    options,
    value,
    onChange,
    hasImages,
    onImageClick
}: {
    options: QuestionOption[];
    value?: number;
    onChange: (optionId: number | undefined) => void;
    hasImages: boolean;
    onImageClick: (url: string) => void;
}) {
    const handleOptionClick = (optionId: number) => {
        if (value === optionId) {
            onChange(undefined);
        } else {
            onChange(optionId);
        }
    };

    return (
        <div className="input-group">
            <p className="input-label">Select one:</p>
            <div className={`options-container ${hasImages ? 'with-images' : ''}`}>
                {options.map((opt, idx) => {
                    const optDir = detectScriptDirection(opt.option_text);
                    const isSelected = value === opt.option_id;
                    return (
                        <div
                            key={opt.option_id}
                            className={`option-card ${isSelected ? 'selected' : ''}`}
                            dir={optDir}
                            onClick={() => handleOptionClick(opt.option_id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                                if (e.key === ' ' || e.key === 'Enter') {
                                    e.preventDefault();
                                    handleOptionClick(opt.option_id);
                                }
                            }}
                        >
                            <div className="option-header">
                                <input
                                    type="radio"
                                    name={`mcq-${options[0].option_id}`}
                                    checked={isSelected}
                                    onChange={() => {}}
                                    className="radio-input"
                                    tabIndex={-1}
                                />
                                <span className="option-letter">{String.fromCharCode(65 + idx)}</span>
                            </div>
                            {opt.option_image_url && (
                                <OfflineImage 
                                    src={opt.option_image_url} 
                                    alt={opt.option_text} 
                                    className="option-image" 
                                    style={{ cursor: 'zoom-in' }}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onImageClick(opt.option_image_url!);
                                    }}
                                />
                            )}
                            {opt.option_text && (
                                <span className="option-text" dir={optDir} style={{ whiteSpace: 'pre-wrap' }}>{opt.option_text}</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ============ MULTIPLE SELECT INPUT ============

function MultipleSelectInput({
    options,
    value,
    onChange,
    hasImages,
    onImageClick
}: {
    options: QuestionOption[];
    value: number[];
    onChange: (selected: number[]) => void;
    hasImages: boolean;
    onImageClick: (url: string) => void;
}) {
    const toggleOption = (optionId: number) => {
        if (value.includes(optionId)) {
            onChange(value.filter(id => id !== optionId));
        } else {
            onChange([...value, optionId]);
        }
    };

    return (
        <div className="input-group">
            <p className="input-label">Select all that apply:</p>
            <div className={`options-container ${hasImages ? 'with-images' : ''}`}>
                {options.map((opt, idx) => {
                    const optDir = detectScriptDirection(opt.option_text);
                    const isSelected = value.includes(opt.option_id);
                    return (
                        <div
                            key={opt.option_id}
                            className={`option-card ${isSelected ? 'selected' : ''}`}
                            dir={optDir}
                            onClick={() => toggleOption(opt.option_id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                                if (e.key === ' ' || e.key === 'Enter') {
                                    e.preventDefault();
                                    toggleOption(opt.option_id);
                                }
                            }}
                        >
                            <div className="option-header">
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {}}
                                    className="checkbox-input"
                                    tabIndex={-1}
                                />
                                <span className="option-letter">{String.fromCharCode(65 + idx)}</span>
                            </div>
                            {opt.option_image_url && (
                                <OfflineImage 
                                    src={opt.option_image_url} 
                                    alt={opt.option_text} 
                                    className="option-image" 
                                    style={{ cursor: 'zoom-in' }}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onImageClick(opt.option_image_url!);
                                    }}
                                />
                            )}
                            {opt.option_text && (
                                <span className="option-text" dir={optDir} style={{ whiteSpace: 'pre-wrap' }}>{opt.option_text}</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ============ TRUE/FALSE INPUT ============

function TrueFalseInput({
    value,
    onChange
}: {
    value?: string;
    onChange: (value?: string) => void;
}) {
    const handleOptionClick = (option: string) => {
        if (value === option) {
            onChange(undefined);
        } else {
            onChange(option);
        }
    };

    return (
        <div className="input-group">
            <div className="true-false-container">
                {['True', 'False'].map((option) => {
                    const isSelected = value === option;
                    return (
                        <div
                            key={option}
                            className={`tf-option ${isSelected ? 'selected' : ''}`}
                            onClick={() => handleOptionClick(option)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                                if (e.key === ' ' || e.key === 'Enter') {
                                    e.preventDefault();
                                    handleOptionClick(option);
                                }
                            }}
                        >
                            <input
                                type="radio"
                                checked={isSelected}
                                onChange={() => {}}
                                className="radio-input"
                                tabIndex={-1}
                            />
                            <span>{option}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ============ TEXT INPUT ============

function TextInput({
    value,
    onChange
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    const dir = detectScriptDirection(value);
    return (
        <input
            type="text"
            value={value}
            dir={dir}
            onChange={(e) => onChange(e.target.value)}
            className="text-input"
            placeholder="Your answer"
        />
    );
}

// ============ TEXTAREA INPUT ============

function TextAreaInput({
    value,
    onChange
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    const dir = detectScriptDirection(value);
    return (
        <textarea
            value={value}
            dir={dir}
            onChange={(e) => onChange(e.target.value)}
            className="textarea-input"
            placeholder="Your answer"
            rows={5}
        />
    );
}

// ============ NUMBER INPUT ============

function NumberInput({
    value,
    onChange
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="number-input"
            placeholder="0"
        />
    );
}

// ============ RANGE INPUT ============

function RangeInput({
    min,
    max,
    value,
    onChange
}: {
    min: number;
    max: number;
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <div className="input-group">
            <div className="range-container">
                <span className="range-label">{min}</span>
                <input
                    type="range"
                    min={min}
                    max={max}
                    value={value}
                    onChange={(e) => onChange(parseInt(e.target.value, 10))}
                    className="range-input"
                />
                <span className="range-label">{max}</span>
            </div>
            <p className="range-value">Selected: <strong>{value}</strong></p>
        </div>
    );
}

// ============ RANKING INPUT ============

function RankingInput({
    options,
    value,
    onChange,
    onImageClick
}: {
    options: QuestionOption[];
    value: number[];
    onChange: (order: number[]) => void;
    onImageClick: (url: string) => void;
}) {
    const handleRankChange = (optionId: number, rank: number) => {
        const rankMap = new Map<number, number>();
        options.forEach((opt, idx) => {
            const existingRank = value.indexOf(opt.option_id);
            rankMap.set(opt.option_id, existingRank >= 0 ? existingRank + 1 : idx + 1);
        });

        rankMap.set(optionId, rank);

        const sorted = Array.from(rankMap.entries())
            .sort((a, b) => a[1] - b[1])
            .map(([id]) => id);

        onChange(sorted);
    };

    return (
        <div className="input-group">
            <p className="input-label">Assign rank to each option (1 = highest):</p>
            <div className="ranking-group">
                {options.map((opt) => {
                    const currentRank = value.indexOf(opt.option_id);
                    return (
                        <div key={opt.option_id} className="ranking-option">
                            <div className="ranking-content">
                                <span className="ranking-text" style={{ whiteSpace: 'pre-wrap' }}>{opt.option_text}</span>
                                {opt.option_image_url && (
                                    <OfflineImage 
                                        src={opt.option_image_url} 
                                        alt={opt.option_text} 
                                        className="ranking-image"
                                        style={{ cursor: 'zoom-in' }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onImageClick(opt.option_image_url!);
                                        }}
                                    />
                                )}
                            </div>
                            <select
                                value={currentRank >= 0 ? currentRank + 1 : ''}
                                onChange={(e) => handleRankChange(opt.option_id, parseInt(e.target.value, 10))}
                                className="ranking-select"
                            >
                                <option value="">-</option>
                                {options.map((_, idx) => (
                                    <option key={idx + 1} value={idx + 1}>{idx + 1}</option>
                                ))}
                            </select>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ============ IMAGE UPLOAD INPUT ============

function ImageUploadInput({
    value,
    onChange
}: {
    value?: File;
    onChange: (file: File | undefined) => void;
}) {
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) {
            onChange(undefined);
            return;
        }

        // Use file directly without compression as requested
        onChange(file);
    };

    return (
        <div className="input-group">
            <div className="file-upload-container">
                <input
                    type="file"
                    accept="image/jpeg,image/png,image/jpg"
                    onChange={handleFileChange}
                    className="file-input"
                    id="file-upload"
                />
                <label
                    htmlFor="file-upload"
                    className="file-upload-label"
                >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <span className="material-symbols-rounded">photo_camera</span>
                        Choose Image
                    </span>
                </label>
            </div>
            {value && (
                <div className="file-preview">
                    <span className="file-name" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span className="material-symbols-rounded" style={{ fontSize: '16px', color: 'var(--color-success)' }}>check_circle</span>
                        {value.name}
                    </span>
                    <span className="file-size">({(value.size / 1024).toFixed(0)} KB)</span>
                </div>
            )}
        </div>
    );
}
