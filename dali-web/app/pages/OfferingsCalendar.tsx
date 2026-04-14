import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import { Offering } from '@shared/api';
import { useOfferings } from '@/hooks/use-offerings';

// Get days in a month
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// Get the day of the week the month starts on (0 = Sunday)
function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

// Month names
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Type colors for offerings
const TYPE_COLORS: Record<string, { bg: string; border: string; dot: string }> = {
  'workshop': { bg: 'bg-accent-teal/20', border: 'border-accent-teal', dot: 'bg-accent-teal' },
  'mini-series': { bg: 'bg-accent-coral/20', border: 'border-accent-coral', dot: 'bg-accent-coral' },
  'fellowship': { bg: 'bg-accent-yellow/20', border: 'border-accent-yellow', dot: 'bg-[#D4A000]' },
};

const OfferingsCalendar: React.FC = () => {
  const { data: offerings = [], isLoading: loading } = useOfferings();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedOffering, setSelectedOffering] = useState<Offering | null>(null);

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  // Group offerings by date for quick lookup
  const offeringsByDate = useMemo(() => {
    const map = new Map<string, Offering[]>();
    offerings.forEach(offering => {
      if (offering.date.fullDate) {
        const dateKey = offering.date.fullDate.split('T')[0];
        const existing = map.get(dateKey) || [];
        map.set(dateKey, [...existing, offering]);
      }
    });
    return map;
  }, [offerings]);

  // Calendar grid data
  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
    const days: Array<{ day: number | null; date: string | null; offerings: Offering[] }> = [];

    // Empty cells for days before the first of the month
    for (let i = 0; i < firstDay; i++) {
      days.push({ day: null, date: null, offerings: [] });
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({
        day,
        date: dateStr,
        offerings: offeringsByDate.get(dateStr) || []
      });
    }

    return days;
  }, [currentYear, currentMonth, offeringsByDate]);

  // Navigation
  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Check if a day is today
  const isToday = (day: number | null): boolean => {
    if (!day) return false;
    const today = new Date();
    return day === today.getDate() &&
           currentMonth === today.getMonth() &&
           currentYear === today.getFullYear();
  };

  // Check if a date string is in the past
  const isPast = (dateStr: string | null): boolean => {
    if (!dateStr) return false;
    const today = new Date().toISOString().split('T')[0];
    return dateStr < today;
  };

  // Split offerings into upcoming and past for the list view
  const todayStr = new Date().toISOString().split('T')[0];
  const upcomingOfferings = offerings.filter(o => o.date.fullDate && o.date.fullDate.split('T')[0] >= todayStr);

  return (
    <div className="min-h-screen bg-background overflow-x-clip">
      <Navbar />

      {/* Header */}
      <section className="pt-32 pb-8 px-6 md:px-12 lg:px-20 bg-white">
        <div className="max-w-7xl mx-auto">
          <Link
            to="/education"
            className="inline-flex items-center gap-2 text-accent-teal hover:text-accent-teal/80 transition mb-6"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Education
          </Link>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-dark-blue mb-4">
            Offerings Calendar
          </h1>
          <p className="text-lg md:text-xl text-gray-600">
            View all upcoming workshops, mini-series, and fellowships
          </p>
        </div>
      </section>

      {/* Legend */}
      <section className="px-6 md:px-12 lg:px-20 bg-white pb-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-wrap gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-accent-teal"></div>
              <span className="text-gray-600">Workshop</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-accent-coral"></div>
              <span className="text-gray-600">Mini-Series</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#D4A000]"></div>
              <span className="text-gray-600">Fellowship</span>
            </div>
          </div>
        </div>
      </section>

      {/* Calendar */}
      <section id="calendar" className="py-8 px-6 md:px-12 lg:px-20 bg-white">
        <div className="max-w-7xl mx-auto">
          {loading ? (
            <div className="py-12 text-center text-gray-500">Loading calendar...</div>
          ) : (
            <div className="bg-section-bg rounded-2xl p-6 md:p-8">
              {/* Calendar Header */}
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <h2 className="text-2xl md:text-3xl font-bold text-dark-blue">
                    {MONTH_NAMES[currentMonth]} {currentYear}
                  </h2>
                  <button
                    onClick={goToToday}
                    className="px-4 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 transition text-gray-600"
                  >
                    Today
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={goToPreviousMonth}
                    className="p-2 rounded-lg hover:bg-gray-200 transition"
                    aria-label="Previous month"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={goToNextMonth}
                    className="p-2 rounded-lg hover:bg-gray-200 transition"
                    aria-label="Next month"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Day Headers */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {DAY_NAMES.map(day => (
                  <div key={day} className="text-center text-sm font-medium text-gray-500 py-2">
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((dayData, index) => (
                  <div
                    key={index}
                    className={`min-h-[80px] sm:min-h-[100px] md:min-h-[120px] p-1.5 sm:p-2 rounded-lg border transition ${
                      dayData.day
                        ? 'bg-white border-gray-200 hover:border-gray-300'
                        : 'bg-transparent border-transparent'
                    }`}
                  >
                    {dayData.day && (
                      <>
                        <div className={`text-sm font-medium mb-1 ${
                          isToday(dayData.day)
                            ? 'w-7 h-7 bg-dark-blue text-white rounded-full flex items-center justify-center'
                            : isPast(dayData.date) ? 'text-gray-400' : 'text-gray-700'
                        }`}>
                          {dayData.day}
                        </div>
                        <div className="space-y-1">
                          {dayData.offerings.slice(0, 2).map((offering) => {
                            const colors = TYPE_COLORS[offering.type] || TYPE_COLORS.workshop;
                            return (
                              <button
                                key={offering.id}
                                onClick={() => setSelectedOffering(offering)}
                                className={`w-full text-left text-[10px] sm:text-xs p-1 sm:p-1.5 rounded ${colors.bg} hover:opacity-80 transition truncate ${isPast(dayData.date) ? 'opacity-40' : ''}`}
                              >
                                <div className="flex items-center gap-1">
                                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${colors.dot}`}></div>
                                  <span className="truncate text-dark-blue">{offering.name}</span>
                                </div>
                              </button>
                            );
                          })}
                          {dayData.offerings.length > 2 && (
                            <button
                              onClick={() => setSelectedOffering(dayData.offerings[0])}
                              className="text-xs text-gray-500 hover:text-gray-700 transition"
                            >
                              +{dayData.offerings.length - 2} more
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Upcoming List View */}
      <section className="py-8 px-6 md:px-12 lg:px-20 bg-white">
        <div className="max-w-7xl mx-auto">
          <h3 className="text-xl md:text-2xl font-bold text-dark-blue mb-6">Upcoming Offerings</h3>

          {upcomingOfferings.length === 0 ? (
            <div className="py-8 text-center text-gray-500">No upcoming offerings at this time.</div>
          ) : (
            <div className="space-y-4">
              {upcomingOfferings.map((offering) => {
                const colors = TYPE_COLORS[offering.type] || TYPE_COLORS.workshop;
                return (
                  <div
                    key={offering.id}
                    className={`flex flex-col md:flex-row md:items-center p-6 rounded-xl border ${colors.border} ${colors.bg} gap-4 md:gap-8`}
                  >
                    <div className="flex-shrink-0 w-20 md:w-24">
                      <div className="text-3xl md:text-4xl font-bold text-dark-blue">{offering.date.day}</div>
                      <div className="text-sm text-dark-blue/70">{offering.date.month}</div>
                      {offering.date.year && (
                        <div className="text-xs text-dark-blue/50">{offering.date.year}</div>
                      )}
                      {offering.date.time && (
                        <div className="text-xs text-dark-blue/60 mt-0.5">{offering.date.time}</div>
                      )}
                    </div>
                    <div className="flex-grow">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-2 h-2 rounded-full ${colors.dot}`}></div>
                        <span className="text-xs uppercase tracking-wide text-dark-blue/60 font-medium">
                          {offering.type.replace('-', ' ')}
                        </span>
                      </div>
                      <h4 className="text-lg md:text-xl font-semibold text-dark-blue mb-2">
                        {offering.name}
                      </h4>
                      {offering.description && (
                        <p className="text-sm text-dark-blue/70 mb-3">{offering.description}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {offering.tags.map((tag, tagIndex) => (
                          <span
                            key={tagIndex}
                            className="px-3 py-1 bg-white/50 border border-gray-200 text-gray-600 text-xs rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <a
                        href={offering.signUpLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-dark-blue text-white rounded-lg hover:bg-dark-blue/90 transition text-sm font-medium"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Sign Up
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Selected Offering Modal */}
      {selectedOffering && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedOffering(null)}
        >
          <div
            className="bg-white rounded-2xl p-5 sm:p-6 md:p-8 max-w-[95vw] sm:max-w-md md:max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2 h-2 rounded-full ${TYPE_COLORS[selectedOffering.type]?.dot || 'bg-accent-teal'}`}></div>
                  <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                    {selectedOffering.type.replace('-', ' ')}
                  </span>
                </div>
                <h3 className="text-xl md:text-2xl font-bold text-dark-blue">
                  {selectedOffering.name}
                </h3>
              </div>
              <button
                onClick={() => setSelectedOffering(null)}
                className="p-2 hover:bg-gray-100 rounded-lg transition"
                aria-label="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-4 mb-4 text-dark-blue">
              <div className="text-4xl font-bold">{selectedOffering.date.day}</div>
              <div>
                <div className="text-lg">{selectedOffering.date.month}</div>
                {selectedOffering.date.year && (
                  <div className="text-sm text-gray-500">{selectedOffering.date.year}</div>
                )}
                {selectedOffering.date.time && (
                  <div className="text-sm text-gray-500">{selectedOffering.date.time}</div>
                )}
              </div>
            </div>

            {selectedOffering.description && (
              <p className="text-gray-600 mb-4">{selectedOffering.description}</p>
            )}

            <div className="flex flex-wrap gap-2 mb-6">
              {selectedOffering.tags.map((tag, tagIndex) => (
                <span
                  key={tagIndex}
                  className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm rounded"
                >
                  {tag}
                </span>
              ))}
            </div>

            <a
              href={selectedOffering.signUpLink}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-accent-coral text-white rounded-lg hover:bg-accent-coral/90 transition font-medium"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Sign Up for this Offering
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default OfferingsCalendar;
